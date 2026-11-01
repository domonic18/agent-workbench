#!/bin/sh
# 采集器一键安装 / 升级脚本(只支持 macOS)
# 用法:
#   curl -fsSL <release>/install-collector.sh | sh -s -- --url https://aw.example.com --id <collector_id>
set -eu

REPO="${AW_COLLECTOR_REPO:-domonic18/agent-workbench}"
VERSION="latest"
URL=""
COLLECTOR_ID=""
PROJECTS=""
STATE_DIR="${AW_STATE_DIR:-$HOME/.aw-collector}"
LABEL="com.agent-workbench.collector"
BACKFILL=0
YES=0
CLAUDE_DIR=""
CC_DIR=""

usage() {
  cat <<'EOF'
用法: install-collector.sh --url <控制台地址> --id <collector_id> [选项]

选项:
  --url <url>           控制台地址,如 https://aw.example.com
  --id <collector_id>   控制台签发的机器 ID
  --projects <a,b>      本机已登记项目,逗号分隔(会写入 launchd)
  --state-dir <path>    本地状态目录,默认 ~/.aw-collector
  --backfill            首次安装时回读历史会话(默认从文件末尾开始)
  --version <tag>       指定 Release 版本,默认 latest
  --label <label>       launchd 标签,默认 com.agent-workbench.collector
  --claude-dir <path>   覆盖 Claude 数据目录
  --cc-connect-dir <p>  覆盖 cc-connect 数据目录
  --yes                 不询问确认(自动化/Agent 代跑)
  -h, --help            显示帮助

密钥优先读 AW_COLLECTOR_SECRET,否则交互式隐藏输入。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --id) COLLECTOR_ID="$2"; shift 2 ;;
    --projects) PROJECTS="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --backfill) BACKFILL=1; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --claude-dir) CLAUDE_DIR="$2"; shift 2 ;;
    --cc-connect-dir) CC_DIR="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$URL" ] || [ -z "$COLLECTOR_ID" ]; then
  echo "缺少 --url 或 --id" >&2
  usage >&2
  exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "采集器目前只支持 macOS" >&2
  exit 2
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "不支持的 CPU 架构: $(uname -m)" >&2; exit 2 ;;
esac

if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi
ASSET="aw-collector-macos-$ARCH"

if [ -z "${AW_COLLECTOR_SECRET:-}" ]; then
  if [ -r /dev/tty ]; then
    printf '采集器密钥(输入时不显示): ' > /dev/tty
    OLD_STTY=$(stty -g < /dev/tty 2>/dev/null || true)
    if [ -n "$OLD_STTY" ]; then stty -echo < /dev/tty; fi
    IFS= read -r AW_COLLECTOR_SECRET < /dev/tty || true
    if [ -n "$OLD_STTY" ]; then stty "$OLD_STTY" < /dev/tty; fi
    printf '\n' > /dev/tty
  fi
fi

if [ -z "${AW_COLLECTOR_SECRET:-}" ]; then
  echo "缺少采集器密钥:请设置 AW_COLLECTOR_SECRET,或在终端里交互输入" >&2
  exit 2
fi

if [ "$YES" != "1" ] && [ -r /dev/tty ]; then
  printf '将安装采集器 %s 到 %s,继续? [y/N] ' "$ASSET" "$STATE_DIR" > /dev/tty
  IFS= read -r ANSWER < /dev/tty || ANSWER=""
  case "$ANSWER" in
    y|Y|yes|YES) ;;
    *) echo "已取消" >&2; exit 1 ;;
  esac
fi

TMPDIR_AW=$(mktemp -d "${TMPDIR:-/tmp}/aw-collector.XXXXXX")
cleanup() { rm -rf "$TMPDIR_AW"; }
trap cleanup EXIT INT TERM

echo "下载 $ASSET ($VERSION) ..."
curl --fail --location --silent --show-error --retry 3 \
  -o "$TMPDIR_AW/$ASSET" "$BASE/$ASSET"
curl --fail --location --silent --show-error --retry 3 \
  -o "$TMPDIR_AW/checksums.txt" "$BASE/checksums.txt"

EXPECTED=$(awk -v name="$ASSET" '$2 == name { print $1 }' "$TMPDIR_AW/checksums.txt")
if [ -z "$EXPECTED" ]; then
  echo "checksums.txt 中找不到 $ASSET,拒绝安装" >&2
  exit 1
fi
ACTUAL=$(shasum -a 256 "$TMPDIR_AW/$ASSET" | awk '{ print $1 }')
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "SHA-256 校验失败:期望 $EXPECTED,实际 $ACTUAL" >&2
  exit 1
fi
chmod 755 "$TMPDIR_AW/$ASSET"

set -- install --url "$URL" --id "$COLLECTOR_ID" --state-dir "$STATE_DIR" --label "$LABEL"
if [ -n "$PROJECTS" ]; then set -- "$@" --projects "$PROJECTS"; fi
if [ -n "$CLAUDE_DIR" ]; then set -- "$@" --claude-dir "$CLAUDE_DIR"; fi
if [ -n "$CC_DIR" ]; then set -- "$@" --cc-connect-dir "$CC_DIR"; fi
if [ "$BACKFILL" = "1" ]; then set -- "$@" --backfill; fi

AW_COLLECTOR_SECRET="$AW_COLLECTOR_SECRET" "$TMPDIR_AW/$ASSET" "$@"

echo ""
echo "自检:"
AW_COLLECTOR_SECRET="$AW_COLLECTOR_SECRET" AW_INGEST_URL="$URL" \
  AW_COLLECTOR_ID="$COLLECTOR_ID" AW_STATE_DIR="$STATE_DIR" \
  "$TMPDIR_AW/$ASSET" doctor || echo "自检未全部通过,请查看上面的输出与 ~/.aw-collector/collector.err"

echo ""
echo "完成。查看状态: ~/.local/bin/aw-collector status"
echo "若 ~/.local/bin 不在 PATH,执行: echo 'export PATH=$HOME/.local/bin:\$PATH' >> ~/.zshrc"
