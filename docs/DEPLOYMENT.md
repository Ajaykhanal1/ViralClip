# Production deployment

This deployment is a single-host Docker Compose stack. It is **not** executed by this repository's
CI; run the steps below on the target host. Do not report a deployment as successful until
`scripts/verify-production-flow.mjs` passes on that host.

## Prerequisites

- Linux host with Docker Engine and the Compose plugin, Git, `curl`, and `openssl`.
- DNS for `DOMAIN` pointing at the host, and ports 80/443 open.
- A TLS certificate for `DOMAIN` (see [DNS and TLS](DNS_TLS.md)).
- Node.js is **not** required on the host; all builds happen inside images.

## 1. Prepare configuration

```bash
git clone <repo-url> viralclip
cd viralclip
cp .env.example .env

bash scripts/generate-secrets.sh
```

Put the generated values into `.env`. Required production settings:

- `NODE_ENV=production`
- `DOMAIN`, `CORS_ORIGINS`, `APP_URL`, `NEXT_PUBLIC_API_URL`, `GOOGLE_REDIRECT_URI`
- `AUTH_ACCESS_SECRET` (32+ chars), `YOUTUBE_TOKEN_ENCRYPTION_KEY`
- `MYSQL_ROOT_PASSWORD`, `DB_PASSWORD`, `REDIS_PASSWORD`
- `AI_SERVICE_TOKEN` and `SERVICE_TOKEN` (identical random values)
- `REDIS_URL=redis://:<password>@redis:6379`
- SMTP settings, Google OAuth client settings, and `YOUTUBE_API_KEY`

The application refuses to start in production with development secret fallbacks.

## 2. Place TLS certificates

Create `deploy/certs/` with `fullchain.pem` and `privkey.pem`. The directory is mounted read-only
into nginx. See [DNS and TLS](DNS_TLS.md).

## 3. Validate and deploy

```bash
docker compose -f docker-compose.prod.yml config --quiet
bash scripts/deploy.sh
```

`scripts/deploy.sh` builds the images, runs migrations once, starts the stack, and verifies the
public flow. If verification fails, the script exits non-zero: investigate before calling the
deployment successful.

Useful direct commands:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=200
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

## 4. Verify manually

```bash
BASE_URL=https://example.com node scripts/verify-production-flow.mjs
```

The script checks web health, API liveness/readiness (MySQL and Redis), registration, an
authenticated `/auth/me` request, and logout. It creates a unique throwaway account each run.

## 5. Storage and uploads

`LOCAL_STORAGE_DIR` is `/data/storage` inside the API, worker, and AI containers, backed by the
`storage` Docker volume. Back up this volume together with MySQL; it contains uploaded media,
generated clips, and rights documents. `STORAGE_DRIVER=s3` is defined but **not implemented**—do
not enable it.

## 6. Updates

```bash
git pull --ff-only
bash scripts/deploy.sh
```

For a bad release, see [Rollback](ROLLBACK.md). For data safety, take a database backup before
non-trivial upgrades:

```bash
bash scripts/backup-mysql.sh
```
