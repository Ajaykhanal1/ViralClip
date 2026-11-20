# Backup and restore

## What must be backed up

| Data | Location | Method |
| --- | --- | --- |
| MySQL metadata | `mysql-data` volume | `scripts/backup-mysql.sh` |
| Uploaded media and generated clips | `storage` volume | filesystem/volume snapshot |
| TLS private keys | `deploy/certs` | secure secret store |
| `.env` secrets | host only | secret manager, never Git |

Redis contains queue state, not durable business data. Its AOF volume can be snapshotted, but
restoring stale queue data is usually worse than letting BullMQ rebuild it.

## Scheduled backups

Run on the host with cron (or a systemd timer):

```cron
0 3 * * * cd /srv/viralclip && bash scripts/backup-mysql.sh >> logs/backup.log 2>&1
```

`BACKUP_RETENTION_DAYS` (default 14) controls local retention. Copy at least one backup off-host.
Backups are gzip-compressed `mysqldump --single-transaction` files of the application schema.

## Snapshot the storage volume

```bash
docker run --rm -v viralclip-prod_storage:/data -v "$PWD/backups":/backup alpine \
  tar czf /backup/storage-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /data .
```

Confirm the actual volume name with `docker volume ls`; Compose prefixes it with the project name.

## Restore

```bash
# Stop the API and worker so no writes race the restore.
docker compose -f docker-compose.prod.yml stop api worker

bash scripts/restore-mysql.sh backups/viralclip-YYYYMMDDTHHMMSSZ.sql.gz

# Restore the storage volume if media is missing or corrupted, then restart.
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```

The restore script requires typing `RESTORE` before it writes. After restoring an older database,
run migrations for the checked-out code version and then verify the public flow.

## Restore drill

At least quarterly, restore a backup into a disposable stack and run
`BASE_URL=https://staging.example.com node scripts/verify-production-flow.mjs`. An untested backup
is not a backup.
