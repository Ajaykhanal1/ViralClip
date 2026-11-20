# Rollback

Rollback changes application code and configuration to a previous Git ref. It **does not** revert
database migrations automatically: down migrations are not maintained, and reverting schema while
new data exists can destroy information.

## Application rollback

```bash
bash scripts/rollback.sh <git-ref>
```

The script:

1. Fetches tags/refs and checks out `<git-ref>`.
2. Rebuilds images and restarts the stack.
3. Runs `scripts/verify-production-flow.mjs` against `https://$DOMAIN`.
4. If verification fails, checks out the previous commit, rebuilds, restarts, and exits non-zero.

Example:

```bash
git tag --list 'v*'
bash scripts/rollback.sh v0.1.0
```

## Database-aware rollback

If the target ref requires an older schema:

1. Take a current backup: `bash scripts/backup-mysql.sh`.
2. Stop writes (maintenance window).
3. Restore the backup created **before** the bad migration:
   `bash scripts/restore-mysql.sh backups/<file>.sql.gz`.
4. Check out the target ref and run `bash scripts/deploy.sh`.

Only restore an older backup knowingly; it discards data written since that backup.

## Verification after rollback

```bash
docker compose -f docker-compose.prod.yml ps
BASE_URL=https://example.com node scripts/verify-production-flow.mjs
```

Do not declare the rollback successful unless both commands pass.
