#!/usr/bin/env bash
# PostgreSQL 一致性备份(02 §8):pg_dump --format=custom 落 workspace/backups/,
# 保留最近 14 份;--verify 把最新一份恢复到临时库,核对表计数后销毁临时库。
# 备份是明文凭据材料:目录 0700、文件 0600,不上传任何外部存储。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${BACKUP_DIR:-$ROOT/workspace/backups}"
KEEP="${BACKUP_KEEP:-14}"
SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${PG_USER:-agent_workbench}"
PG_DB="${PG_DB:-agent_workbench}"
COMPOSE="${COMPOSE:-docker compose -p agent-workbench --env-file $ROOT/.env -f $ROOT/docker/docker-compose.yml}"

usage() {
  cat <<'EOF'
用法: scripts/backup.sh [--verify] [备份文件]

  --verify        把最近一份备份恢复到临时库核对表计数(不给文件名时取最新)
  <备份文件>      指定要校验的备份文件

不带参数时执行一次备份,产物路径打印到 stdout。
EOF
}

# 备份文件集:文件名 console-YYYYmmdd-HHMMSS.dump,字典序即时间序
list_backups() {
  [ -d "$DEST" ] || return 0
  find "$DEST" -maxdepth 1 -name 'console-*.dump' -type f | sort -r
}

do_backup() {
  umask 077
  mkdir -p "$DEST"
  chmod 700 "$DEST"

  target="$DEST/console-$(date +%Y%m%d-%H%M%S).dump"
  # pg_dump 自定义格式默认写 stdout,直接落到宿主机文件,不在容器内留副本
  $COMPOSE exec -T "$SERVICE" \
    pg_dump --username="$PG_USER" --dbname="$PG_DB" --format=custom --no-password > "$target"
  chmod 600 "$target"

  total=$(list_backups | wc -l | tr -d ' ')
  if [ "$total" -gt "$KEEP" ]; then
    list_backups | tail -n "+$((KEEP + 1))" | while IFS= read -r old; do
      rm -f "$old"
      echo "已删除过期备份: $old"
    done
  fi

  echo "$target"
}

# 表计数:源库与恢复库的 public schema 表数必须一致
count_tables() {
  $COMPOSE exec -T "$SERVICE" \
    psql --username="$PG_USER" --dbname="$1" --no-password --tuples-only --no-align \
    --command="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
}

do_verify() {
  source_file="${1:-}"
  if [ -z "$source_file" ]; then
    source_file="$(list_backups | head -1)"
  fi
  if [ -z "$source_file" ] || [ ! -f "$source_file" ]; then
    echo "没有可校验的备份:先执行 scripts/backup.sh" >&2
    exit 1
  fi

  tmpdb="aw_restore_check_$$"
  cleanup() {
    $COMPOSE exec -T "$SERVICE" \
      psql --username="$PG_USER" --dbname=postgres --no-password \
      --command="DROP DATABASE IF EXISTS $tmpdb" >/dev/null 2>&1 || true
  }
  trap cleanup EXIT

  $COMPOSE exec -T "$SERVICE" \
    psql --username="$PG_USER" --dbname=postgres --no-password --set ON_ERROR_STOP=1 \
    --command="DROP DATABASE IF EXISTS $tmpdb" --command="CREATE DATABASE $tmpdb"

  $COMPOSE exec -T "$SERVICE" \
    pg_restore --username="$PG_USER" --dbname="$tmpdb" --no-password \
    --no-owner --no-privileges --exit-on-error < "$source_file"

  source_count="$(count_tables "$PG_DB" | tr -d '[:space:]')"
  restored_count="$(count_tables "$tmpdb" | tr -d '[:space:]')"
  if [ "$source_count" != "$restored_count" ]; then
    echo "校验失败:源库 $source_count 张表,恢复库 $restored_count 张表" >&2
    exit 1
  fi

  echo "校验通过: $source_file(表计数 $restored_count,与源库一致)"
}

case "${1:-}" in
  --verify)
    shift
    do_verify "${1:-}"
    ;;
  -h|--help)
    usage
    ;;
  "")
    do_backup
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
