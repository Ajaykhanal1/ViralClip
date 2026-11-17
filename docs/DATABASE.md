# Database

MySQL 8+ is the only supported database. InnoDB, `utf8mb4`, `utf8mb4_0900_ai_ci`. SQLite is not
used anywhere.

## Connection

Configured through environment variables, validated at process start:

| Variable | Default | Notes |
| --- | --- | --- |
| `DB_HOST` | `127.0.0.1` | |
| `DB_PORT` | `3306` | Compose publishes this port |
| `DB_USER` | `viralclip` | Application user, not root |
| `DB_PASSWORD` | empty | Set in `.env` |
| `DB_NAME` | `viralclip` | |
| `DB_POOL_LIMIT` | `10` | mysql2 pool `connectionLimit` |

Pool settings in `apps/api/src/db/mysql.ts`: keep-alive enabled, `timezone: 'Z'`,
`supportBigNumbers`, `decimalNumbers`. Migrations use a separate short-lived connection with
`multipleStatements: true`; the application pool does not.

Docker Compose creates the database and user from the same `.env` values, so host and container
credentials stay aligned.

## Schema

`apps/api/migrations/001_init.sql` creates the Phase 1 tables and `002_auth.sql` adds accounts and
sessions:

```
users 1 ─── n projects 1 ─── n videos 1 ─── n clips
  │
  ├── n refresh_tokens
  ├── n email_verifications
  └── n password_resets
```

### users

| Column | Type | Notes |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED AI | PK |
| `email` | VARCHAR(255) | Unique |
| `display_name` | VARCHAR(120) | |
| `password_hash` | VARCHAR(255) | bcrypt hash; never returned by the API |
| `role` | ENUM | `user`, `admin`; default `user` |
| `email_verified_at` | TIMESTAMP NULL | Set when the verification token is consumed |
| `last_login_at` | TIMESTAMP NULL | Reserved for login reporting |
| `created_at`, `updated_at` | TIMESTAMP | DB-managed |

### refresh_tokens

| Column | Type | Notes |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED AI | PK |
| `user_id` | BIGINT UNSIGNED | FK → `users.id`, cascade delete |
| `token_hash` | CHAR(64) | Unique SHA-256 of the opaque token |
| `expires_at` | TIMESTAMP | 30 days by default |
| `revoked_at` | TIMESTAMP NULL | Set on rotation, logout, password change, or reuse detection |
| `created_at` | TIMESTAMP | |

Index: `(user_id, expires_at)`.

### email_verifications

| Column | Type | Notes |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED AI | PK |
| `user_id` | BIGINT UNSIGNED | FK → `users.id`, cascade delete |
| `token_hash` | CHAR(64) | Unique SHA-256 of the emailed token |
| `expires_at` | TIMESTAMP | 24 hours |
| `used_at` | TIMESTAMP NULL | Single use |
| `created_at` | TIMESTAMP | |

### password_resets

| Column | Type | Notes |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED AI | PK |
| `user_id` | BIGINT UNSIGNED | FK → `users.id`, cascade delete |
| `token_hash` | CHAR(64) | Unique SHA-256 of the emailed token |
| `expires_at` | TIMESTAMP | 1 hour |
| `used_at` | TIMESTAMP NULL | Single use |
| `created_at` | TIMESTAMP | |

### projects

| Column | Type | Notes |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED AI | PK |
| `user_id` | BIGINT UNSIGNED | FK → `users.id`, cascade delete |
| `title` | VARCHAR(200) | |
| `status` | ENUM | `draft`, `processing`, `ready`, `failed` |
| timestamps | TIMESTAMP | |

Index: `(user_id, status)`.

### videos

| Column | Type | Notes |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED AI | PK |
| `project_id` | BIGINT UNSIGNED | FK → `projects.id`, cascade delete |
| `original_filename` | VARCHAR(255) | Display only |
| `storage_key` | VARCHAR(512) | Unique; path/object key, **not the file** |
| `mime_type` | VARCHAR(100) NULL | |
| `size_bytes` | BIGINT UNSIGNED NULL | |
| `duration_seconds` | DECIMAL(10,3) NULL | |
| `status` | ENUM | `uploaded`, `processing`, `ready`, `failed` |
| timestamps | TIMESTAMP | |

Indexes: unique `storage_key`, `(project_id, status)`.

### clips

| Column | Type | Notes |
| --- | --- | --- |
| `id` | BIGINT UNSIGNED AI | PK |
| `video_id` | BIGINT UNSIGNED | FK → `videos.id`, cascade delete |
| `title` | VARCHAR(200) | |
| `start_seconds`, `end_seconds` | DECIMAL(10,3) | `CHECK (end_seconds > start_seconds)` |
| `storage_key` | VARCHAR(512) NULL | Unique when set |
| `status` | ENUM | `pending`, `processing`, `ready`, `failed` |
| `virality_score` | DECIMAL(5,2) NULL | `CHECK` 0–100 when set |
| timestamps | TIMESTAMP | |

Index: `(video_id, status)`.

### schema_migrations

Created automatically by the runner:

| Column | Type |
| --- | --- |
| `name` | VARCHAR(255) PK |
| `checksum` | CHAR(64) |
| `applied_at` | TIMESTAMP |

## Migration infrastructure

- Files live in `apps/api/migrations/`, named `NNN_snake_name.sql` (e.g. `002_add_caption.sql`).
- Applied in filename order. Duplicate numeric prefixes and non-matching names are rejected.
- A SHA-256 checksum is stored per file. Editing an applied migration fails the next run; add a new
  migration instead.
- Each file is executed with `multipleStatements`, then recorded. **MySQL DDL is not
  transactional**: a file that fails halfway must be repaired manually before re-running.
- No automatic down migrations. Roll forward with a new SQL file.

Commands, from the repo root:

```bash
npm run db:migrate   # apply pending files
npm run db:status    # show applied/pending
```

### Adding a migration

```sql
-- apps/api/migrations/003_add_render_columns.sql
ALTER TABLE clips ADD COLUMN render_path VARCHAR(512) NULL AFTER storage_key;
```

```bash
npm run db:migrate
```

## Data rules

- Never store video, audio, subtitles, or thumbnails as BLOBs. Store a `storage_key` and write the
  bytes to local storage or S3.
- All queries use placeholders (`?`); never interpolate user input into SQL.
- Foreign keys are enforced; inserting a video for a missing or foreign project returns `404
  PROJECT_NOT_FOUND` via the service layer.
- Passwords are bcrypt hashes. Refresh, reset, and verification tokens are stored only as SHA-256
  hashes; the plaintext token exists only in the cookie or email link.
- Timestamps are UTC in the application (`timezone: 'Z'`); MySQL stores them in its own time zone
  configuration.
- ID columns are `BIGINT UNSIGNED`; API types use `number`, safe for realistic row counts.

## Local database without Docker

```bash
mysql -u root -p -e "CREATE DATABASE viralclip CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -u root -p -e "CREATE USER 'viralclip'@'localhost' IDENTIFIED BY 'viralclip_dev_password';
                     GRANT ALL PRIVILEGES ON viralclip.* TO 'viralclip'@'localhost';"
```

Point `DB_PORT`/`DB_PASSWORD` in `.env` at that server, then run `npm run db:migrate`.

## Backups (production baseline)

Use `mysqldump --single-transaction` (InnoDB consistent snapshot) or a managed MySQL snapshot
service. Binaries live in object storage and need their own lifecycle/backup policy. Test restores;
an untested backup is not a backup.
