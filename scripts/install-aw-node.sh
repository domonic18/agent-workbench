#!/bin/sh
# aw-node 一键安装 / 升级脚本(只支持 macOS)
# 用法:
#   curl -fsSL <release>/install-aw-node.sh | sh -s -- --url https://aw.example.com
# 一次性 enroll token 由脚本交互式隐藏输入;Agent 代跑时经 stdin 或 AW_ENROLL_TOKEN 传入,
# 永不写在命令行参数里。
set -eu

REPO="${AW_NODE_REPO:-domonic18/agent-workbench}"
VERSION="latest"
URL=""
PROJECTS=""
STATE_DIR="${AW_STATE_DIR:-$HOME/.aw-node}"
BACKFILL=0
YES=0
SOURCE="auto"
CLAUDE_DIR=""
CC_DIR=""

usage() {
  cat <<'EOF'
用法: install-aw-node.sh --url <控制台地址> [选项]

选项:
  --url <url>           控制台地址,如 https://aw.example.com
  --projects <a,b>      本机已登记项目,逗号分隔(会写入 launchd)
  --state-dir <path>    本地状态目录,默认 ~/.aw-node
  --backfill            首次安装时回读历史会话(默认从文件末尾开始)
  --version <tag>       指定 Release 版本(如 0.2.1),默认 latest
  --source <auto|console|github>
                        产物来源:auto 先取控制台镜像,取不到再回退 GitHub Release;
                        console 只用控制台;github 只用 GitHub Release
  --claude-dir <path>   覆盖 Claude 数据目录
  --cc-connect-dir <p>  覆盖 cc-connect 数据目录
  --yes                 不询问确认(自动化/Agent 代跑)
  -h, --help            显示帮助

一次性 enroll token 优先读 AW_ENROLL_TOKEN,否则交互式隐藏输入。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --projects) PROJECTS="$2"; shift 2 ;;
    --state-dir) STATE_DIR="$2"; shift 2 ;;
    --backfill) BACKFILL=1; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --source) SOURCE="$2"; shift 2 ;;
    --claude-dir) CLAUDE_DIR="$2"; shift 2 ;;
    --cc-connect-dir) CC_DIR="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$URL" ]; then
  echo "缺少 --url(控制台地址)" >&2
  usage >&2
  exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "aw-node 目前只支持 macOS" >&2
  exit 2
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "不支持的 CPU 架构: $(uname -m)" >&2; exit 2 ;;
esac

if [ "$VERSION" = "latest" ]; then
  GITHUB_BASE="https://github.com/$REPO/releases/latest/download"
else
  case "$VERSION" in
    collector-v*) ;;
    *) VERSION="collector-v$VERSION" ;;
  esac
  GITHUB_BASE="https://github.com/$REPO/releases/download/$VERSION"
fi
CONSOLE_BASE="$URL/artifacts"
ASSET="aw-node-macos-$ARCH"

if [ "$YES" != "1" ] && [ -r /dev/tty ]; then
  printf '将安装 %s 到 %s,继续? [y/N] ' "$ASSET" "$STATE_DIR" > /dev/tty
  IFS= read -r ANSWER < /dev/tty || ANSWER=""
  case "$ANSWER" in
    y|Y|yes|YES) ;;
    *) echo "已取消" >&2; exit 1 ;;
  esac
fi

TMPDIR_AW=$(mktemp -d "${TMPDIR:-/tmp}/aw-node.XXXXXX")
cleanup() { rm -rf "$TMPDIR_AW"; }
trap cleanup EXIT INT TERM

# 产物与校验和必须同源:混源比对会拿两套不同构建的摘要互校
fetch_from() {
  BASE="$1"
  curl --fail --location --silent --show-error --retry 3 \
    -o "$TMPDIR_AW/$ASSET" "$BASE/$ASSET" || return 1
  curl --fail --location --silent --show-error --retry 3 \
    -o "$TMPDIR_AW/checksums.txt" "$BASE/checksums.txt" || return 1
  return 0
}

BASE=""
case "$SOURCE" in
  console)
    echo "从控制台取件 $CONSOLE_BASE/$ASSET ..."
    fetch_from "$CONSOLE_BASE" || {
      echo "控制台没有该平台产物(缺 $ASSET 或 checksums.txt)" >&2
      echo "改用 --source github 从 GitHub Release 取" >&2
      exit 1
    }
    BASE="$CONSOLE_BASE"
    ;;
  github)
    echo "从 GitHub Release 取件 $GITHUB_BASE/$ASSET ..."
    fetch_from "$GITHUB_BASE" || {
      echo "下载失败(产物或 checksums.txt 取不到)" >&2
      exit 1
    }
    BASE="$GITHUB_BASE"
    ;;
  auto)
    echo "从控制台取件 $CONSOLE_BASE/$ASSET ..."
    if fetch_from "$CONSOLE_BASE"; then
      BASE="$CONSOLE_BASE"
    else
      echo "控制台无产物,回退 GitHub Release ..."
      fetch_from "$GITHUB_BASE" || {
        echo "下载失败(控制台与 GitHub 都取不到产物)" >&2
        exit 1
      }
      BASE="$GITHUB_BASE"
    fi
    ;;
  *)
    echo "未知 --source: $SOURCE(取 auto|console|github)" >&2
    exit 2
    ;;
esac
echo "来源 $BASE"

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

set -- "$TMPDIR_AW/$ASSET" enroll --url "$URL" --state-dir "$STATE_DIR"
if [ -n "$PROJECTS" ]; then set -- "$@" --projects "$PROJECTS"; fi
if [ -n "$CLAUDE_DIR" ]; then set -- "$@" --claude-dir "$CLAUDE_DIR"; fi
if [ -n "$CC_DIR" ]; then set -- "$@" --cc-connect-dir "$CC_DIR"; fi
if [ "$BACKFILL" = "1" ]; then set -- "$@" --backfill; fi

# token 经 stdin 传给 enroll(非 TTY 时 aw-node 直接读管道),不落命令行与 shell history
run_enroll() {
  if [ -n "${AW_ENROLL_TOKEN:-}" ]; then
    "$@"
  elif [ -r /dev/tty ]; then
    printf 'enroll token(一次性,输入不显示): ' > /dev/tty
    OLD_STTY=$(stty -g < /dev/tty 2>/dev/null || true)
    if [ -n "$OLD_STTY" ]; then stty -echo < /dev/tty; fi
    IFS= read -r ENROLL_TOKEN < /dev/tty || ENROLL_TOKEN=""
    if [ -n "$OLD_STTY" ]; then stty "$OLD_STTY" < /dev/tty; fi
    printf '\n' > /dev/tty
    if [ -n "$ENROLL_TOKEN" ]; then
      printf '%s' "$ENROLL_TOKEN" | "$@"
    else
      "$@"
    fi
  else
    "$@"
  fi
}

if ! run_enroll "$@"; then
  echo "" >&2
  if [ -f "$STATE_DIR/credentials.json" ]; then
    # 凭据已落盘说明兑换成功、失败在装载环节:重装不需要再要 token
    echo "机器凭据已落盘($STATE_DIR/credentials.json),装载失败可直接重试,无需再要 token:" >&2
    echo "  $HOME/.local/bin/aw-node install --url $URL" >&2
  else
    echo "enroll 未完成,机器未登记;请检查 token 是否过期(15 分钟有效)后重试。" >&2
  fi
  exit 1
fi

echo ""
echo "自检:"
AW_STATE_DIR="$STATE_DIR" "$TMPDIR_AW/$ASSET" doctor || echo "自检未全部通过,请查看上面的输出与 $STATE_DIR/aw-node.err"

echo ""
echo "完成。查看状态: ~/.local/bin/aw-node status"
echo "若 ~/.local/bin 不在 PATH,执行: echo 'export PATH=$HOME/.local/bin:\$PATH' >> ~/.zshrc"
