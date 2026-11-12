#!/usr/bin/env bash
# 部署单入口(CI 与人工同一条命令,部署逻辑唯一真相源):
#   bash scripts/deploy.sh --tag main-<sha7> --image-repo <registry/namespace/aw-console>
#   bash scripts/deploy.sh --gc-only --image-repo <registry/namespace/aw-console>
# 在部署目录执行(cwd 无关,按脚本自身位置定位到目录根):
#   tag 白名单 → 预检 → .env 备份轮转 → 写 IMAGE → 拉镜像
#   → compose up --wait(迁移随应用启动,健康检查即迁移闸门)
#   → .deploy-state 落盘 → 失败用 previous IMAGE 自动回滚
#   → 退出兜底镜像回收(保留最新 3 个 sha tag;--gc-only 只回收)
# 迁移 forward-only:回滚不回滚数据库,新 DDL 必须旧代码可容忍(02 §7)。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"
COMPOSE_FILE="docker/docker-compose.prod.yml"
STATE_FILE=".deploy-state"
# 项目名沿用 agent-workbench:与旧栈共用 agent-workbench_postgres 数据卷,
# 部署目录迁移不丢数据;--remove-orphans 把已从 compose 移除的服务(如
# 旧栈的 frpc)收走,运行面收敛到文件定义的两件套
COMPOSE="docker compose -p agent-workbench --env-file $ENV_FILE -f $COMPOSE_FILE"

IMAGE_REPO=""
TAG=""
GC_ONLY=0
RUN_GC=0

usage() {
  cat <<'EOF'
用法: scripts/deploy.sh --tag <main-sha7+> --image-repo <registry/namespace/aw-console>
      scripts/deploy.sh --gc-only --image-repo <registry/namespace/aw-console>

  --tag          镜像 tag,只放行 ^main-[0-9a-f]{7,40}$(不可变,不收 latest)
  --image-repo   镜像仓库全路径(registry/namespace/repo),回收过滤也用它
  --gc-only      不部署,只按保留策略回收本机镜像
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag 缺参数}" && shift 2 ;;
    --image-repo) IMAGE_REPO="${2:?--image-repo 缺参数}" && shift 2 ;;
    --gc-only) GC_ONLY=1 && shift ;;
    *) usage >&2 && exit 2 ;;
  esac
done

[ -n "$IMAGE_REPO" ] || { usage >&2; exit 2; }
case "$IMAGE_REPO" in
  *[^a-z0-9./_-]*) echo "ERROR: --image-repo 含非法字符: $IMAGE_REPO" >&2 && exit 2 ;;
esac
if [ "$GC_ONLY" -ne 1 ]; then
  case "$TAG" in
    main-*) ;;
    *) echo "ERROR: tag 必须形如 main-<sha7+>,收到: $TAG" >&2 && exit 2 ;;
  esac
  sha="${TAG#main-}"
  if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{7,40}$'; then
    echo "ERROR: tag 的 sha 段只认 7~40 位十六进制,收到: $TAG" >&2
    exit 2
  fi
fi

preflight_common() {
  docker info >/dev/null 2>&1 || { echo "ERROR: docker 不可用" >&2; exit 1; }
}

preflight_deploy() {
  preflight_common
  docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose v2 不可用" >&2; exit 1; }
  [ -f "$COMPOSE_FILE" ] || { echo "ERROR: 缺 $COMPOSE_FILE" >&2; exit 1; }
  [ -f "$ENV_FILE" ] || { echo "ERROR: 缺 $ENV_FILE(部署目录须先人工就位)" >&2; exit 1; }
  grep -q '^POSTGRES_PASSWORD=..*' "$ENV_FILE" || { echo "ERROR: $ENV_FILE 缺 POSTGRES_PASSWORD" >&2; exit 1; }

  avail_gb="$(df -g . | awk 'NR==2 {print $4}')"
  if [ "${avail_gb:-0}" -lt 5 ]; then
    echo "ERROR: 磁盘余量 ${avail_gb}G < 5G" >&2
    exit 1
  fi

  # 栈已起但 postgres 不健康 → 硬失败(真故障不豁免);栈未起(首次部署)放行
  pg_health="$($COMPOSE ps --format '{{.Service}}|{{.Health}}' 2>/dev/null \
    | grep '^postgres|' | cut -d'|' -f2 || true)"
  if [ -n "$pg_health" ] && [ "$pg_health" != "healthy" ]; then
    echo "ERROR: postgres 容器状态 $pg_health,先修复再部署" >&2
    exit 1
  fi
}

backup_env() {
  rm -f "$ENV_FILE.bak.2"
  if [ -f "$ENV_FILE.bak.1" ]; then mv "$ENV_FILE.bak.1" "$ENV_FILE.bak.2"; fi
  if [ -f "$ENV_FILE.bak" ]; then mv "$ENV_FILE.bak" "$ENV_FILE.bak.1"; fi
  cp "$ENV_FILE" "$ENV_FILE.bak"
}

current_image() {
  grep '^IMAGE=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

set_image() {
  grep -v '^IMAGE=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '\nIMAGE=%s\n' "$1" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

tag_of() { printf '%s' "${1##*:}"; }

# $1=current_image $2=previous_image $3=status
write_state() {
  printf 'current_image=%s\ncurrent_tag=%s\nprevious_image=%s\nprevious_tag=%s\ndeployed_at=%s\nstatus=%s\n' \
    "$1" "$(tag_of "$1")" "$2" "$(tag_of "$2")" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$3" > "$STATE_FILE"
}

# $1=failed_image $2=prev_image
rollback() {
  local failed="$1" prev="$2"
  echo "[FAIL] 部署失败,回滚: $failed → ${prev:-<无>}" >&2
  # 回滚会重建容器,失败现场日志随容器销毁——先转储到 stderr 再回滚,
  # 否则「起不来」只剩一个 unhealthy,根因(如迁移 checksum)无处可查
  echo "--- 失败容器日志(console 最近 80 行) ---" >&2
  $COMPOSE logs --no-color --tail 80 console >&2 || true
  if [ -z "$prev" ]; then
    write_state "$failed" "" FAILED
    echo "ERROR: 无 previous 镜像可回滚(首次部署),保留现场人工处理" >&2
    exit 1
  fi
  set_image "$prev"
  if ! docker pull "$prev" >/dev/null 2>&1 \
    && ! docker image inspect "$prev" >/dev/null 2>&1; then
    write_state "$failed" "$prev" FAILED_ROLLED_BACK_FAILED
    echo "ERROR: 回滚镜像不可用(仓库与本地都拉不到)" >&2
    exit 1
  fi
  if $COMPOSE up -d --wait --wait-timeout 180 --no-build --pull never --remove-orphans; then
    write_state "$prev" "$prev" FAILED_ROLLED_BACK
    echo "[WARN] 已回滚到 $prev,保留失败现场(日志不删)" >&2
  else
    write_state "$prev" "$prev" FAILED_ROLLED_BACK_FAILED
    echo "ERROR: 回滚仍失败,需人工介入;不要清日志" >&2
  fi
  # 部署失败无论回滚成败,CI 都要红
  exit 1
}

do_deploy() {
  local new_image="$IMAGE_REPO:$TAG"
  local prev_image
  prev_image="$(current_image)"
  echo "[deploy] $prev_image → $new_image"

  backup_env
  set_image "$new_image"

  if ! docker pull "$new_image"; then
    if docker image inspect "$new_image" >/dev/null 2>&1; then
      echo "[WARN] 拉取失败,但本地已有同 tag 镜像,继续(回滚场景)" >&2
    else
      # 未换容器不算部署过:IMAGE 回写 previous,current 保持 previous(可为空)
      if [ -n "$prev_image" ]; then
        set_image "$prev_image"
      fi
      write_state "${prev_image:-}" "${prev_image:-}" FAILED
      echo "ERROR: 镜像拉取失败且本地无缓存" >&2
      exit 1
    fi
  fi

  # 迁移随应用启动:起不来的根因多半在迁移,--wait 健康检查就是迁移闸门
  if ! $COMPOSE up -d --wait --wait-timeout 180 --no-build --pull never --remove-orphans; then
    rollback "$new_image" "$prev_image"
  fi

  running="$($COMPOSE ps --status running --format '{{.Service}}' | sort | tr '\n' ' ' | sed 's/ $//')"
  expect="$(printf 'console\npostgres\n' | sort | tr '\n' ' ' | sed 's/ $//')"
  if [ "$running" != "$expect" ]; then
    echo "ERROR: 运行面不全: 实际[$running] 期望[$expect]" >&2
    rollback "$new_image" "$prev_image"
  fi

  write_state "$new_image" "$prev_image" OK
  echo "[OK] 部署完成: $new_image"
}

gc_images() {
  local keep=3 lines to_delete t size deleted=0 bytes=0
  # 只认 sha tag:latest 不参与(项目禁推 latest,出现即 WARN,删不删由人定)
  lines="$(docker images --format '{{.Tag}} {{.CreatedAt}}' "$IMAGE_REPO" 2>/dev/null \
    | grep -E '^main-[0-9a-f]{7,40} ' || true)"
  if [ -z "$lines" ]; then
    echo "[WARN][gc] $IMAGE_REPO 下没有匹配 ^main-<sha>\$ 的镜像;空结果不是「无需清理」的证据,多半是仓库路径写错(docker images 按完整仓库名匹配)" >&2
  fi
  if docker images --format '{{.Tag}}' "$IMAGE_REPO" 2>/dev/null | grep -qx latest; then
    echo "[WARN][gc] 存在 latest 标签镜像:不计入保留额度也不删除,人工决定" >&2
  fi

  to_delete="$(printf '%s\n' "$lines" | sort -k2 -r | tail -n +$((keep + 1)) | awk '{print $1}')"
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    size="$(docker image inspect -f '{{.Size}}' "$IMAGE_REPO:$t" 2>/dev/null || echo 0)"
    if docker rmi "$IMAGE_REPO:$t" >/dev/null 2>&1; then
      deleted=$((deleted + 1))
      bytes=$((bytes + size))
    else
      echo "[WARN][gc] 删除失败(镜像可能正被容器使用): $IMAGE_REPO:$t" >&2
    fi
  done < <(printf '%s\n' "$to_delete")

  # 悬空层清理;绝不用 -a:会把保留中的回滚目标一起删掉
  docker image prune -f >/dev/null
  echo "[gc] 删除 ${deleted} 个镜像,回收 $((bytes / 1024 / 1024)) MB(保留最新 ${keep} 个 tag)"
}

# 部署路径的清理由退出兜底保证:成功、失败、中途退出都跑一次,
# 否则「拉镜像失败 → 不清理 → 只增不减」是个闭环
trap 'if [ "$RUN_GC" = 1 ]; then gc_images || echo "[WARN][gc] 回收失败(不影响部署结论)" >&2; fi' EXIT

if [ "$GC_ONLY" -eq 1 ]; then
  # 回收只依赖 docker 与镜像仓库路径,不碰 .env、compose 与容器
  preflight_common
  gc_images
else
  preflight_deploy
  RUN_GC=1
  do_deploy
fi
