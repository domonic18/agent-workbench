#!/bin/sh
# 发布执行面产物到控制台取件口(workspace/artifacts)。
#
# 背景:执行机所在网络可能到不了 GitHub(实测本机网络即如此),
# 控制台镜像一份产物即可让新机器只从控制台取件,安装脚本仍保留 GitHub Release 兜底。
#
# 产物与 checksums.txt 必须同批生成:混批比对会拿两次构建的摘要互校。
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="${AW_ARTIFACT_DIR:-$ROOT/workspace/artifacts}"
BUN="${BUN:-bun}"
BUN_VERSION="${BUN_VERSION:-1.4.4}"
BIN_DIR="$ROOT/collector/dist/bin"

if ! command -v "$BUN" > /dev/null 2>&1; then
  # 本机没有 bun 时走 npm 分发的固定版本,避免每次构建产物不一致
  echo "未找到 $BUN,改用 npx bun@$BUN_VERSION"
  BUN="npx --yes bun@$BUN_VERSION"
fi

echo "构建 aw-node(macos arm64 / x64) ..."
cd "$ROOT/collector"
$BUN build src/main.ts --compile --minify --target=bun-darwin-arm64 \
  --outfile "$BIN_DIR/aw-node-macos-arm64"
$BUN build src/main.ts --compile --minify --target=bun-darwin-x64 \
  --outfile "$BIN_DIR/aw-node-macos-x64"

mkdir -p "$OUT"
cp "$BIN_DIR/aw-node-macos-arm64" "$BIN_DIR/aw-node-macos-x64" "$OUT/"

# 摘要格式与 shasum 输出一致("<hash>  <name>"),安装脚本按此解析
cd "$OUT"
shasum -a 256 aw-node-macos-arm64 aw-node-macos-x64 > checksums.txt

# 控制台据此展示「执行机可升级」提示;与产物同批生成,不混批
node -p "require('$ROOT/collector/package.json').version" | tr -d '\n' > version.txt

echo ""
echo "已发布到 $OUT:"
ls -l "$OUT"
echo ""
cat "$OUT/checksums.txt"
echo "version: $(cat "$OUT/version.txt")"
