#!/usr/bin/env bash
# Teleport CE 按 Agent/任务签发身份的最小可复现验证(S3)。
# 用法: ./run.sh up | ssh | report | down
set -euo pipefail
cd "$(dirname "$0")"

TP_VERSION=18.7.3
PROJECT=aw-teleport-spike
TP_IMAGE=public.ecr.aws/gravitational/teleport-distroless:${TP_VERSION}
TBOT_IMAGE=public.ecr.aws/gravitational/tbot-distroless:${TP_VERSION}
NODE_IMAGE=aw-tp-node:${TP_VERSION}
NODE=aw-tp-node
NODENAME=""
AUDIT_IMAGE=alpine:3

OUT=$PWD/out
PKI=$PWD/pki
CA_PIN=""

compose() { docker compose -p "$PROJECT" -f compose.yaml "$@"; }
tctl() { compose exec -T auth /usr/local/bin/tctl "$@"; }
auth_id() { compose ps -q auth; }

gen_pki() {
  [ -f "$PKI/ca.crt" ] && return
  mkdir -p "$PKI"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -keyout "$PKI/ca.key" -out "$PKI/ca.crt" -subj "/CN=aw-spike-ca" >/dev/null 2>&1
  cat >"$PKI/ext.cnf" <<'EOF'
subjectAltName=DNS:auth,DNS:localhost,DNS:aw-spike.teleport.cluster.local,DNS:*.aw-spike.teleport.cluster.local,IP:127.0.0.1
extendedKeyUsage=serverAuth
basicConstraints=CA:FALSE
EOF
  openssl req -newkey rsa:2048 -nodes -keyout "$PKI/server.key" -out "$PKI/server.csr" \
    -subj "/CN=aw-spike.teleport.cluster.local" >/dev/null 2>&1
  openssl x509 -req -in "$PKI/server.csr" -CA "$PKI/ca.crt" -CAkey "$PKI/ca.key" \
    -CAcreateserial -out "$PKI/server.crt" -days 30 -extfile "$PKI/ext.cnf" >/dev/null 2>&1
  chmod 600 "$PKI/ca.key" "$PKI/server.key"
}

compute_pin() {
  CA_PIN="sha256:$(openssl x509 -in "$PKI/ca.crt" -outform der | openssl dgst -sha256 -binary | base64)"
}

# 从 stdin 读 YAML,拷进 auth 容器后 tctl create
apply_yaml() {
  local force=""
  [ "${1:-}" = "--force" ] && force="--force"
  local tmp; tmp=$(mktemp /tmp/aw-spike-XXXXXX.yaml)
  cat >"$tmp"
  docker cp "$tmp" "$(auth_id):/tmp/aw-spike.yaml" >/dev/null
  rm -f "$tmp"
  tctl create $force -f /tmp/aw-spike.yaml >/dev/null
}

create_roles() {
  apply_yaml --force <<'YAML'
kind: role
version: v8
metadata:
  name: aw-ext
spec:
  allow:
    logins: ["agentwork"]
    node_labels:
      aw: "spike-node"
  options:
    cert_extensions:
      - type: ssh
        mode: extension
        name: aw-task-id
        value: "{{ external.aw_task_id }}"
      - type: ssh
        mode: extension
        name: aw-ticket-id
        value: "{{ external.aw_ticket_id }}"
YAML
  apply_yaml --force <<'YAML'
kind: role
version: v8
metadata:
  name: aw-int
spec:
  allow:
    logins: ["agentwork"]
    node_labels:
      aw: "spike-node"
  options:
    cert_extensions:
      - type: ssh
        mode: extension
        name: aw-task-id
        value: "{{ internal.aw_task_id }}"
YAML
}

create_bot() {
  local name=$1 task=$2 ticket=$3
  tctl bots add "$name" --roles=aw-ext >/dev/null 2>&1 || true
  apply_yaml --force <<YAML
kind: bot
version: v1
metadata:
  name: $name
spec:
  max_session_ttl: 43200s
  roles: [aw-ext]
  traits:
    - name: aw_task_id
      values: ["$task"]
    - name: aw_ticket_id
      values: ["$ticket"]
YAML
}

# 每次 join 都需要一次性 token;bots add 里带的 token 在失败后即作废
bot_token() {
  tctl bots instances add "$1" 2>/dev/null | grep -oE -- '--token=[a-f0-9]{32}' | head -1 | cut -d= -f2
}

# bot traits 异步同步到 user,证书插值读的是 user;同步未完成就签发会得到
# 未插值的字面量模板(实测踩过),所以签发前必须等 user 上出现目标 ticket
wait_bot_traits() {
  local name=$1 ticket=$2 i
  for i in $(seq 1 100); do
    tctl get "user/bot-$name" 2>/dev/null | grep -q "$ticket" && return 0
    sleep 0.1
  done
  echo "bot $name 的 traits 未同步到 user" >&2
  return 1
}

issue_identity() {
  local name=$1 token=$2
  local dir=$OUT/$name
  mkdir -p "$dir"
  docker run --rm --network "container:$(auth_id)" \
    -e SSL_CERT_FILE=/etc/pki/ca.crt \
    -v "$PKI/ca.crt":/etc/pki/ca.crt:ro \
    -v "$dir":/identity \
    --entrypoint /usr/local/bin/tbot "$TBOT_IMAGE" start legacy \
      --destination-dir=/identity --data-dir=/state \
      --token="$token" --proxy-server=localhost:3080 --join-method=token \
      --ca-pin="$CA_PIN" --certificate-ttl=15m --renewal-interval=10s --oneshot
}

start_node() {
  local token=$1
  # 同名节点重注册会留下重复 host 记录,tsh 按名寻址会报二义;每轮换唯一名
  NODENAME="aw-tp-node-$(date +%s)"
  echo "$NODENAME" >"$OUT/node-name"
  docker build -q -t "$NODE_IMAGE" node/ >/dev/null
  docker rm -f "$NODE" >/dev/null 2>&1 || true
  docker run -d --name "$NODE" \
    --network "container:$(auth_id)" \
    -e SSL_CERT_FILE=/etc/pki/ca.crt \
    -v "$PKI/ca.crt":/etc/pki/ca.crt:ro \
    "$NODE_IMAGE" \
      --roles=node --auth-server=localhost:3080 --token="$token" \
      --nodename="$NODENAME" --labels=aw=spike-node --ca-pin="$CA_PIN" >/dev/null
}

wait_node() {
  local i
  for i in $(seq 1 30); do
    # 表格输出会截断主机名,必须读 json 的 hostname
    tctl nodes ls --format=json 2>/dev/null | grep -q "\"hostname\": *\"$NODENAME\"" && return 0
    sleep 1
  done
  echo "node 未在 30s 内注册" >&2
  docker logs "$NODE" 2>&1 | tail -20 >&2
  return 1
}

tsh_ssh() {
  local identity=$1 user=$2
  docker run --rm --network "container:$(auth_id)" \
    -v "$identity":/identity:ro \
    --entrypoint /usr/local/bin/tsh "$TP_IMAGE" \
      --proxy=localhost:3080 --identity=/identity/identity --insecure \
      ssh "$user@$NODENAME" hostname
}

up() {
  mkdir -p "$PKI" "$OUT"
  gen_pki
  compute_pin
  compose up -d --wait
  create_roles
  # internal.* 不参与插值:用用户证书复现
  tctl users add u-aw-int --roles=aw-int >/dev/null 2>&1 || true
  tctl auth sign --user=u-aw-int --ttl=15m --format=openssh --overwrite --out=/tmp/u-aw-int >/dev/null
  docker cp "$(auth_id):/tmp/u-aw-int-cert.pub" "$OUT/u-aw-int-cert.pub" >/dev/null
  create_bot bot-a task-0001 cap_0001
  create_bot bot-b task-0002 cap_0002
  wait_bot_traits bot-a cap_0001
  wait_bot_traits bot-b cap_0002
  issue_identity bot-a "$(bot_token bot-a)"
  issue_identity bot-b "$(bot_token bot-b)"
  start_node "$(tctl tokens add --type=node --ttl=20m | grep -oE '[a-f0-9]{32}' | head -1)"
  wait_node
  ssh_test
  report
}

ssh_test() {
  local i
  NODENAME=$(cat "$OUT/node-name")
  echo "== 正向: bot-a -> agentwork@$NODENAME"
  # 节点注册早于反向上线,需等隧道建立
  for i in $(seq 1 20); do
    tsh_ssh "$OUT/bot-a" agentwork 2>/dev/null && break
    [ "$i" = 20 ] && tsh_ssh "$OUT/bot-a" agentwork
    sleep 1
  done
  echo "== 反向: bot-a -> root@$NODENAME 应被拒绝"
  local out
  out=$(tsh_ssh "$OUT/bot-a" root 2>&1 || true)
  if grep -q "access denied" <<<"$out"; then
    echo "denied as expected"
  else
    echo "意外:root 被放行" >&2
    echo "$out" >&2
  fi
}

# 续期验证:同一个 bot 以 30s TTL / 10s interval 持续续期,证书文件应被重写
renew_test() {
  local name=bot-a dir=$OUT/bot-a
  local token; token=$(bot_token "$name")
  [ -n "$token" ] || { echo "未取到 $name 的 join token" >&2; return 1; }
  docker rm -f aw-tp-tbot-renew >/dev/null 2>&1 || true
  docker run -d --name aw-tp-tbot-renew \
    --network "container:$(auth_id)" \
    -e SSL_CERT_FILE=/etc/pki/ca.crt \
    -v "$PKI/ca.crt":/etc/pki/ca.crt:ro \
    -v "$dir":/identity \
    --entrypoint /usr/local/bin/tbot "$TBOT_IMAGE" start legacy \
      --destination-dir=/identity --data-dir=/state \
      --token="$token" --proxy-server=localhost:3080 --join-method=token \
      --ca-pin="$CA_PIN" --certificate-ttl=30s --renewal-interval=10s >/dev/null
  sleep 12
  local first; first=$(shasum -a 256 "$dir/key-cert.pub" | cut -d' ' -f1)
  sleep 12
  local second; second=$(shasum -a 256 "$dir/key-cert.pub" | cut -d' ' -f1)
  docker rm -f aw-tp-tbot-renew >/dev/null 2>&1 || true
  echo "== 首轮证书 $first"
  echo "== 次轮证书 $second"
  if [ "$first" != "$second" ]; then
    echo "renewed as expected"
  else
    echo "证书未续期" >&2
    return 1
  fi
}

report() {
  local f
  if [ -f "$PKI/ca.crt" ]; then compute_pin; fi
  echo "== CA pin: $CA_PIN"
  for f in "$OUT"/bot-a/key-cert.pub "$OUT"/bot-b/key-cert.pub "$OUT"/u-aw-int-cert.pub; do
    echo "-- $f"
    ssh-keygen -L -f "$f" 2>/dev/null | grep -E 'Key ID|Valid:|aw-task-id|aw-ticket-id' | sed 's/UNKNOWN OPTION: //' || true
  done
  echo "== 最近 3 条 session.start"
  # events.log 是指向 /var/lib/teleport/log 的符号链接,须挂到原路径
  docker run --rm -v "${PROJECT}_aw-tp-data":/var/lib/teleport:ro "$AUDIT_IMAGE" \
    sh -c "grep '\"session.start\"' /var/lib/teleport/log/events.log | tail -3" \
    | grep -oE '"user":"[^"]*"|"login":"[^"]*"|"server_hostname":"[^"]*"|"sid":"[^"]*"|aw_task_id":\[[^]]*\]'
}

down() {
  docker rm -f "$NODE" >/dev/null 2>&1 || true
  compose down -v >/dev/null 2>&1 || true
  # 只删本次构建的镜像,上游镜像留在缓存里供下次复用
  docker rmi "$NODE_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$PKI" "$OUT"
  echo "已销毁:$PROJECT 容器/卷与本地 $PKI $OUT;上游镜像保留"
}

case "${1:-}" in
  up) up ;;
  ssh) ssh_test ;;
  renew) compute_pin; renew_test ;;
  report) report ;;
  down) down ;;
  *) echo "用法: $0 {up|ssh|renew|report|down}" >&2; exit 1 ;;
esac
