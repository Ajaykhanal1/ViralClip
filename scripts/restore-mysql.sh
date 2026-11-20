#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_FILE="${1:?usage: scripts/restore-mysql.sh <backup.sql.gz>}"
test -f "$BACKUP_FILE" || { echo "Backup not found: $BACKUP_FILE" >&2; exit 1; }

read -r -p "This replaces the current database. Type RESTORE to continue: " CONFIRM
test "$CONFIRM" = RESTORE || { echo "Aborted" >&2; exit 1; }

gunzip -c "$BACKUP_FILE" | docker compose -f docker-compose.prod.yml exec -T mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'

echo "Restore complete. Run migrations for the target code version before starting the API."
