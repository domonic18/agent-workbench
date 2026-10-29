#!/usr/bin/env bash
# 用 sqlite3 .backup 生成一致性快照;WAL 模式下 cp 会丢未 checkpoint 的日志。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DATABASE_PATH:-$ROOT/workspace/console.db}"
DEST="${BACKUP_DIR:-$ROOT/workspace/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ ! -f "$DB" ]; then
  echo "database not found: $DB" >&2
  exit 1
fi

umask 077
mkdir -p "$DEST"

target="$DEST/console-$(date +%Y%m%d-%H%M%S).db"
sqlite3 "$DB" ".backup '$target'"

find "$DEST" -maxdepth 1 -name 'console-*.db' -type f -mtime "+$RETENTION_DAYS" -delete

echo "$target"
