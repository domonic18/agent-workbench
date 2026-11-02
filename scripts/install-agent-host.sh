#!/bin/bash
# agent-workbench 执行面一键安装(2026-11-02):采集器 + proxy bundle + 协作调度器。
# 新机器上执行:
#   curl -fsSL $CONSOLE/artifacts/install.sh -o install.sh
#   bash install.sh --console-url https://aw.17aitech.com \
#     --machine-id <机器id> --machine-secret <采集器密钥> \
#     --projects "project-a,project-b" \
#     [--agent-id agt_x --agent-secret <密钥> --project <项目名> --agent-workdir <仓库目录>]
# 密钥经 flag/env(AW_MACHINE_SECRET / AW_AGENT_SECRET)传入,不落日志;重复执行幂等。
set -euo pipefail

CONSOLE_URL="" MACHINE_ID="" MACHINE_SECRET="" PROJECTS=""
AGENT_ID="" AGENT_SECRET="" AGENT_PROJECT="" AGENT_WORKDIR=""
NAME="" SKIP_COLLECTOR=0 SKIP_DISPATCH=0 DRY_RUN=0

usage() { grep '^#' "$0" | head -9; exit 1; }
while [ $# -gt 0 ]; do
  case "$1" in
    --console-url) CONSOLE_URL="$2"; shift 2 ;;
    --machine-id) MACHINE_ID="$2"; shift 2 ;;
    --machine-secret) MACHINE_SECRET="${2:-${AW_MACHINE_SECRET:-}}"; shift 2 ;;
    --projects) PROJECTS="$2"; shift 2 ;;
    --agent-id) AGENT_ID="$2"; shift 2 ;;
    --agent-secret) AGENT_SECRET="${2:-${AW_AGENT_SECRET:-}}"; shift 2 ;;
    --project) AGENT_PROJECT="$2"; shift 2 ;;
    --agent-workdir) AGENT_WORKDIR="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --skip-collector) SKIP_COLLECTOR=1; shift ;;
    --skip-dispatch) SKIP_DISPATCH=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) echo "未知参数 $1"; exit 1 ;;
  esac
done

[ -n "$CONSOLE_URL" ] || { echo "缺少 --console-url"; exit 1; }
# 密钥支持三种传法:flag 显式 / 空 flag 回退 env / 环境变量直接注入(不传 flag)
MACHINE_SECRET="${MACHINE_SECRET:-${AW_MACHINE_SECRET:-}}"
AGENT_SECRET="${AGENT_SECRET:-${AW_AGENT_SECRET:-}}"
HAVE_COLLECTOR=0
HAVE_DISPATCH=0
if [ "$SKIP_COLLECTOR" = 0 ] && [ -n "$MACHINE_ID" ] && [ -n "$MACHINE_SECRET" ]; then HAVE_COLLECTOR=1; fi
if [ "$SKIP_DISPATCH" = 0 ] && [ -n "$AGENT_ID" ] && [ -n "$AGENT_SECRET" ] && [ -n "$AGENT_PROJECT" ] && [ -n "$AGENT_WORKDIR" ]; then HAVE_DISPATCH=1; fi
[ "$HAVE_COLLECTOR" = 1 ] || [ "$HAVE_DISPATCH" = 1 ] || { echo "采集器与调度器至少装一个(相应 id/secret 缺失)"; exit 1; }

command -v node >/dev/null || { echo "需要 node ≥18"; exit 1; }
ARCH="$(uname -m | sed 's/x86_64/x64/')"
TARBALL="aw-agent-host-darwin-${ARCH}.tar.gz"
TMP="$(mktemp -d)"
BIN_DIR="$HOME/.local/bin"
WORK_DIR="$HOME/.local/share/agent-workbench"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
trap 'rm -rf "$TMP"' EXIT

run() { if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

echo "== 1/4 下载部署包($TARBALL) =="
run curl -fsSL --max-time 300 -o "$TMP/$TARBALL" "$CONSOLE_URL/artifacts/$TARBALL"
run curl -fsSL --max-time 30 -o "$TMP/SHASUMS256.txt" "$CONSOLE_URL/artifacts/SHASUMS256.txt"
if [ "$DRY_RUN" != 1 ]; then
  (cd "$TMP" && shasum -a 256 -c SHASUMS256.txt >/dev/null) || { echo "校验失败"; exit 1; }
  tar -xzf "$TMP/$TARBALL" -C "$TMP"
fi
run mkdir -p "$BIN_DIR" "$WORK_DIR/mcp" "$HOME/.aw-collector" "$LAUNCH_DIR"
run install -m 0755 "$TMP/aw-collector-macos-${ARCH}" "$BIN_DIR/aw-collector"
run install -m 0644 "$TMP/aw-proxy.mjs" "$BIN_DIR/aw-proxy.mjs"
run install -m 0755 "$TMP/aw-dispatch.mjs" "$BIN_DIR/aw-dispatch.mjs"
run install -m 0644 "$TMP/enroll-agent.mjs" "$WORK_DIR/enroll-agent.mjs"

# claude 逐候选验证真实可执行(断链符号链接会被 -x 排除,ENOENT 实证过)
CLI=""
for c in "$(command -v claude 2>/dev/null || true)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
  [ -n "$c" ] && [ -x "$c" ] && CLI="$c" && break
done
NODE_BIN="$(command -v node)"
ENROLL_ENV=""

if [ "$HAVE_DISPATCH" = 1 ]; then
  echo "== 2/4 enroll Agent($AGENT_ID / project $AGENT_PROJECT) =="
  SECRET_FILE="$TMP/agent.secret"
  printf '%s' "$AGENT_SECRET" > "$SECRET_FILE"; chmod 0600 "$SECRET_FILE"
  ENROLL_OUT="$TMP/enroll.out"
  run node "$WORK_DIR/enroll-agent.mjs" --agent-id "$AGENT_ID" --project "$AGENT_PROJECT" \
    --console-url "$CONSOLE_URL" --secret-file "$SECRET_FILE" \
    --proxy "$BIN_DIR/aw-proxy.mjs" --out "$WORK_DIR/mcp" > "$ENROLL_OUT"
  if [ "$DRY_RUN" = 1 ]; then NAME="aw-${AGENT_PROJECT}-dryrun"; else NAME="$(sed -n 's/^MCP server 名: //p' "$ENROLL_OUT" | head -1)"; fi
  [ -n "$NAME" ] || { cat "$ENROLL_OUT"; echo "enroll 输出缺 server 名"; exit 1; }
  ENROLL_ENV="$WORK_DIR/mcp/$NAME.env"
  echo "   env: $ENROLL_ENV"
fi

launchd_write() { # $1=label $2=plist 内容
  [ "$DRY_RUN" = 1 ] && { echo "[dry-run] 写 $LAUNCH_DIR/$1.plist"; return; }
  printf '%s' "$2" > "$LAUNCH_DIR/$1.plist"; chmod 0644 "$LAUNCH_DIR/$1.plist"
  if ! plutil -lint "$LAUNCH_DIR/$1.plist" >/dev/null 2>&1; then
    echo "plist 校验失败: $LAUNCH_DIR/$1.plist"; cat "$LAUNCH_DIR/$1.plist"; exit 1
  fi
}
launchd_load() { # $1=label
  [ "$DRY_RUN" = 1 ] && { echo "[dry-run] launchctl bootout/bootstrap $1"; return; }
  launchctl bootout "gui/$(id -u)/$1" 2>/dev/null || true
  if ! launchctl bootstrap "gui/$(id -u)" "$LAUNCH_DIR/$1.plist" 2>/dev/null; then
    echo "   bootstrap 失败(5),回退 launchctl load -w"
    launchctl load -w "$LAUNCH_DIR/$1.plist"
  fi
}

if [ "$HAVE_COLLECTOR" = 1 ]; then
  echo "== 3/4 安装采集器(macbook 机器 $MACHINE_ID) =="
  launchd_write "com.agent-workbench.collector" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict>
  <key>Label</key><string>com.agent-workbench.collector</string>
  <key>ProgramArguments</key><array><string>$BIN_DIR/aw-collector</string><string>run</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/.aw-collector/collector.log</string>
  <key>StandardErrorPath</key><string>$HOME/.aw-collector/collector.err</string>
  <key>EnvironmentVariables</key><dict>
    <key>AW_INGEST_URL</key><string>$CONSOLE_URL</string>
    <key>AW_COLLECTOR_ID</key><string>$MACHINE_ID</string>
    <key>AW_COLLECTOR_SECRET</key><string>$MACHINE_SECRET</string>
    <key>AW_STATE_DIR</key><string>$HOME/.aw-collector</string>
    <key>AW_AGENT_PROJECTS</key><string>${PROJECTS:-$AGENT_PROJECT}</string>
  </dict></dict></plist>"
  launchd_load "com.agent-workbench.collector"
fi

if [ "$HAVE_DISPATCH" = 1 ]; then
  echo "== 4/4 安装协作调度器(每 60s 拉收件箱) =="
  launchd_write "com.agent-workbench.dispatch" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict>
  <key>Label</key><string>com.agent-workbench.dispatch</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN</string><string>$BIN_DIR/aw-dispatch.mjs</string>
    <string>--env</string><string>$ENROLL_ENV</string>
    <string>--cwd</string><string>$AGENT_WORKDIR</string>${CLI:+
    <string>--claude</string><string>$CLI</string>}
  </array>
  <key>StartInterval</key><integer>60</integer><key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.aw-collector/dispatch.log</string>
  <key>StandardErrorPath</key><string>$HOME/.aw-collector/dispatch.err</string>
</dict></plist>"
  launchd_load "com.agent-workbench.dispatch"
fi

echo "安装完成。校验:"
echo "  launchctl list | grep agent-workbench"
[ "$HAVE_DISPATCH" = 1 ] && echo "  在控制台协作群发起一次交接,观察本机 dispatch.log 与任务落库"
exit 0
