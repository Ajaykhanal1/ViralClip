#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${BACKUP_DIR}/viralclip-${STAMP}.sql.gz"

docker compose -f docker-compose.prod.yml exec -T mysql \
  sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  | gzip > "$OUTPUT"

find "$BACKUP_DIR" -name 'viralclip-*.sql.gz' -type f -mtime +"${BACKUP_RETENTION_DAYS:-14}" -delete
echo "$OUTPUT"
