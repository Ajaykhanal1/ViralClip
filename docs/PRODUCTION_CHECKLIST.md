# Production readiness checklist

Use this before exposing the stack to real users. Every unchecked item is a launch blocker unless
explicitly accepted by the owner.

## Configuration

- [ ] `.env` is filled from `scripts/generate-secrets.sh`; no development fallbacks remain.
- [ ] `NODE_ENV=production` for API, worker, AI, and web.
- [ ] `AUTH_ACCESS_SECRET`, `YOUTUBE_TOKEN_ENCRYPTION_KEY`, `AI_SERVICE_TOKEN`, and `SERVICE_TOKEN`
      are unique; worker/AI service tokens match.
- [ ] `CORS_ORIGINS`, `APP_URL`, `NEXT_PUBLIC_API_URL`, and `GOOGLE_REDIRECT_URI` use the public HTTPS
      domain.
- [ ] SMTP and Google OAuth credentials are real; mail delivery has been tested.
- [ ] `STORAGE_DRIVER=local`; the S3 adapter is not implemented and must not be enabled.

## Network and TLS

- [ ] DNS points at the host; ports 80/443 are open.
- [ ] `deploy/certs/fullchain.pem` and `privkey.pem` are valid and not expired.
- [ ] MySQL and Redis have no host port mappings; only nginx is public.
- [ ] Redis requires a password; its URL in `.env` includes that password.
- [ ] HSTS and TLS 1.2+ are active; HTTPS redirect works.

## Data

- [ ] Migration ran successfully: `docker compose -f docker-compose.prod.yml --profile tools run --rm migrate`.
- [ ] A MySQL backup exists off-host and a restore drill has been completed.
- [ ] The `storage` volume is included in snapshots.
- [ ] File permissions keep `privkey.pem` readable only by the owner.
- [ ] Containers run as the non-root `app` user.

## Verification

- [ ] `docker compose -f docker-compose.prod.yml config --quiet` passes.
- [ ] `bash scripts/deploy.sh` passes.
- [ ] `BASE_URL=https://<domain> node scripts/verify-production-flow.mjs` passes.
- [ ] `/health`, `/api/v1/health/ready`, and `/web-health` return healthy responses through HTTPS.
- [ ] A real user can register, verify email, log in, and log out from a browser.
- [ ] The worker processes a real upload end to end and emits a playable 9:16 MP4.

## Operations

- [ ] Health alerts and disk alerts are configured.
- [ ] Log shipping and retention are configured.
- [ ] Rollback target is tagged and `docs/ROLLBACK.md` has been read.
- [ ] Backup cron and certificate renewal cron are installed.
- [ ] Secrets are stored in a secret manager, not only in a local `.env`.

## Explicit limitations

- Full-stack browser E2E, live MySQL/Redis, Docker builds, and real deployment were **not** run in
  the development environment used to author this phase. They must be run on the target host.
- YouTube publishing and Whisper transcription have only been tested for failure paths locally;
  their external dependencies must be exercised in staging before launch.
- In-memory rate limiting is per API process; keep one API replica or add a shared store before
  scaling out.
