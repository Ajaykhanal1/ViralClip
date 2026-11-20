# Phase 15 — Production deployment configuration

Date: 2026-11-20

## Outcome

Production deployment configuration, scripts, and operator documentation are in place. **No
deployment was performed in this environment.** Docker, MySQL CLI, and Redis CLI are unavailable on
the authoring machine, so image builds, Compose parsing by the Docker engine, database migration
against a live MySQL, and the public HTTPS flow remain to be executed on the target host.

## Files added or changed

- `docker/Dockerfile.api`, `docker/Dockerfile.worker`, `docker/Dockerfile.web`, `docker/Dockerfile.ai`
  — multi-stage builds, production dependencies only, non-root runtime users.
- `docker/Dockerfile.web` uses Next.js `output: 'standalone'` from the current Next.js 16 guide, with
  `outputFileTracingRoot` set to the monorepo root.
- `docker-compose.prod.yml` — single-host stack: MySQL, Redis (password + AOF), API, worker, AI,
  web, nginx, and a one-shot migration service. MySQL/Redis are not published; nginx is the only
  public entry point. Healthchecks, dependency ordering, bounded JSON logs, and a shared storage
  volume are defined.
- `deploy/nginx/default.conf` — HTTP→HTTPS redirect, ACME challenge path, TLS 1.2+, HSTS, 1 GiB
  upload allowance, and proxies for `/api/`, the API liveness probe, the web health probe, and the UI.
- `apps/web/src/app/web-health/route.ts` — dedicated web liveness endpoint used by Compose/nginx.
- `scripts/deploy.sh`, `scripts/rollback.sh`, `scripts/backup-mysql.sh`, `scripts/restore-mysql.sh`,
  `scripts/generate-secrets.sh`, `scripts/verify-production-flow.mjs`.
- `.env.example` — production variables for domains, shared AI token, Redis password, TLS directory,
  and backup retention.
- Six operator docs: `DEPLOYMENT.md`, `ROLLBACK.md`, `BACKUP_RESTORE.md`, `MONITORING_LOGGING.md`,
  `DNS_TLS.md`, `PRODUCTION_CHECKLIST.md`.
- Root `package.json` gained `prod:config`, `prod:deploy`, `prod:rollback`, `prod:backup`, and
  `prod:verify` scripts.

## Validation performed here

| Check | Result |
| --- | --- |
| `npm test` | Pass — API 33, web 18, worker 20 |
| `npm run typecheck` | Pass |
| `npm run build` | Pass — Next.js production build, 22 routes including `/web-health` |
| Standalone web server | Pass — launched `.next/standalone/apps/web/server.js` locally; `/web-health` returned `200 {"status":"ok","service":"viralclip-web"}` |
| `python -m pytest -q services/ai/tests` | Pass — 16 tests |
| `python -m ruff check services/ai` | Pass |
| `node --check scripts/verify-production-flow.mjs` | Pass |
| `docker compose -f docker-compose.prod.yml config --quiet` | Not run — Docker is not installed here |
| Image builds | Not run — Docker is not installed here |
| Live migration / health verification | Not run — no MySQL or Redis available here |

`npm run lint` and `npm run format:check` still fail with the same pre-existing debt reported in
Phase 14; no new lint rule suppression was added.

## Production flow verification (scripted, not executed here)

`scripts/verify-production-flow.mjs` checks, in order:

1. `GET /health` — API liveness.
2. `GET /api/v1/health/ready` — MySQL and Redis reported `up`.
3. `GET /web-health` — web process liveness.
4. `POST /api/v1/auth/register` with a unique throwaway email.
5. `GET /api/v1/auth/me` with the session cookies.
6. `POST /api/v1/auth/logout`.

It exits non-zero on any failed step. `scripts/deploy.sh` calls it after `up -d`, so a failed flow is
not reported as a successful deployment. It must be run against the real host with `BASE_URL` set by
the script from `DOMAIN`.

## Security and operations decisions

- Containers run as a non-root `app` user; production env validation rejects development secrets.
- MySQL and Redis have no host ports; nginx is the only published service.
- Redis requires a password and AOF persistence; worker/AI share one secret token over the internal
  network.
- Logs are JSON with `max-size=20m`/`max-file=5`; docs define alerts and off-host shipping.
- Backups cover MySQL and the shared storage volume; restore requires an explicit `RESTORE` typed
  confirmation. Rollback does not auto-revert schema.
- DNS/TLS docs describe certificate placement, renewal, and HTTPS redirect.

## Remaining risks

- Compose syntax, image builds, and container networking are unverified until Docker is available on
  the target host.
- The nginx TLS config assumes certificates already exist at `TLS_CERT_DIR`; nginx will fail to
  start without them.
- `STORAGE_DRIVER=s3` remains unimplemented; production uses the local `storage` volume.
- Whisper runtime and YouTube publishing have not been exercised against live external services.
- In-memory rate limiting is per API process; keep a single API replica or add a shared store before
  scaling.
- No real production deployment or rollback drill has been performed.

## Production readiness

Conditionally ready for a controlled staging deployment. The configuration includes the required
security boundaries, health checks, backups, and rollback path, but **must not be called deployed or
production-ready until `scripts/deploy.sh` and `scripts/verify-production-flow.mjs` pass on the real
host and the remaining items in `docs/PRODUCTION_CHECKLIST.md` are checked**.
