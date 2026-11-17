# Security

Phase 2 implements authentication and route protection. The controls below are what the code
actually enforces; remaining gaps are listed explicitly so later phases do not assume protection
that is not there.

## Implemented controls

### Authentication and sessions

- Passwords are hashed with bcrypt (cost 12) and never returned by the API. Login compares against
  a dummy hash for unknown emails so response timing does not reveal whether an account exists.
- Access tokens are short-lived HS256 JWTs (15 minutes by default) in the HTTP-only `vc_access`
  cookie. Refresh tokens are 32 random bytes, delivered in the HTTP-only `vc_refresh` cookie; only
  their SHA-256 hash is stored in MySQL.
- Refresh tokens rotate on every use. Reusing a revoked token revokes every session for that user.
  Logout, password change, password reset, and detected reuse all revoke sessions.
- Email verification and password reset tokens are random, single-use, stored as SHA-256 hashes,
  and expire after 24 hours and 1 hour respectively.
- Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, and `Path=/`. Cross-site scripting
  therefore cannot read them. `AUTH_COOKIE_DOMAIN` exists for same-parent-domain hosting.
- `requireAuth` protects `/auth/me*`, resend-verification, admin listing, and `POST /videos`.
  `requireRole('admin')` gates user listing. The video service checks project ownership and returns
  `404 PROJECT_NOT_FOUND` for missing or foreign projects.
- The web `proxy.ts` only performs optimistic redirects. API middleware remains the authorization
  boundary so a matcher mistake cannot expose data.
- Duplicate emails return `409 EMAIL_TAKEN`. Validation errors never echo password values.

### Rate limiting

- Registration, login, refresh, forgot-password, reset-password, verification, and resend endpoints
  have per-IP limits via `express-rate-limit`.
- In production the API trusts one reverse proxy (`trust proxy = 1`) so limits use the client IP.
- The store is in-memory. It is per process and resets on restart; a multi-instance deployment needs
  a shared store.

### Configuration and secrets

- One gitignored `.env`; `.env.example` contains development defaults only.
- API and worker validate environment variables with zod at startup; the AI engine uses
  pydantic-settings. Invalid values stop the process instead of failing later.
- `AUTH_ACCESS_SECRET` must be at least 32 characters and identical for the API and web proxy.
  Production refuses to start with the shared development secret.
- When SMTP is not configured in production, the API logs an error and sends nothing. Development
  logs the verification or reset link to the API console instead.
- No credentials in code or docs beyond disposable development defaults.
- Compose reads the same `.env`; container MySQL credentials are not hardcoded in the application.

### HTTP API

- `helmet` sets standard security headers.
- CORS is an explicit origin allowlist from `CORS_ORIGINS`, not `*`.
- JSON bodies are capped at 1 MB.
- `x-powered-by` is disabled.
- Every request gets or propagates `x-request-id`; response bodies include `requestId` for support.
- Errors are mapped to stable codes. Unexpected errors return a generic message and never a stack
  trace or SQL error.
- Zod validation rejects malformed and oversized fields before they reach SQL.
- Query parameters are always bound with `?` placeholders.
- Logs redact `authorization`, `cookie`, passwords, and tokens.
- State-changing auth routes require JSON bodies, and session cookies are `SameSite=Lax`, which
  blocks cross-site form posts. There is no separate CSRF token; add one if cookies are ever sent
  cross-site or `SameSite` is relaxed.

### Database

- InnoDB with foreign keys and `CHECK` constraints.
- The application user only needs privileges on its own schema (Compose creates a non-root user;
  production should grant only `SELECT, INSERT, UPDATE, DELETE` plus migration rights for the
  migration identity).
- Video/audio bytes are never stored in MySQL; only storage keys.
- Migrations are checksummed, so applied SQL cannot be silently changed.

### Queue, workers, storage

- Redis is only reachable through the Compose host port in development; it is not internet-facing.
- Job payloads contain IDs and storage keys, not credentials or file bytes.
- Workers run the same validated config and use structured logs.
- Storage keys are opaque paths/object keys; the filesystem root is configured by
  `LOCAL_STORAGE_DIR`. **Path traversal validation is not implemented yet** because no upload
  handler exists; it is mandatory before accepting user-supplied keys.

### Dependencies

- `npm audit` reports 0 known vulnerabilities for the installed tree at Phase 2 completion.
- The `package-lock.json` lockfile is kept for reproducible installs.

## Production checklist (before exposing the API)

### Still required before exposing the API

- Shared rate-limit storage (Redis) once more than one API process runs.
- Upload hardening: MIME sniffing, extension allowlist, maximum size/duration, ffprobe validation,
  malware scanning, and 9:16 render limits.
- Storage abstraction: S3 adapter with presigned PUT/GET URLs, server-side encryption, private
  buckets, short expirations, and storage-key sanitization (no `..`, no absolute paths).
- Idempotent workers and an outbox/reconciler for the insert-then-enqueue gap.
- CSRF tokens if cookie scope or `SameSite` policy changes.
- Strict CSP for the web app (Next.js currently ships default headers only).
- Redis authentication/TLS and network isolation.
- MySQL TLS, dedicated least-privilege users, automated backups, restore drills.
- SMTP delivery monitoring, bounce handling, and a queue for retries. Email failures are logged but
  do not fail registration or reset requests.
- Session/device management and an admin action for revoking a user's sessions.

### Deployment baseline

- Never publish MySQL (`3306`) or Redis (`6379`) outside a private network. The current Compose
  file publishes them for local development only; override or remove those mappings in production.
- Put the API behind TLS termination, set `NODE_ENV=production`, and use a secret manager rather
  than a `.env` file.
- Run containers as non-root with read-only filesystems where possible; application Dockerfiles are
  not part of the current phase.
- Centralize logs with retention, access control, and PII review. Request bodies are not logged, but
  URLs and user-supplied IDs are.
- Add dependency and container scanning to CI.

## Known gaps at Phase 2

| Gap | Risk | Guardrail |
| --- | --- | --- |
| In-memory rate limits | Limits are per process and reset on restart | Single-process development; move to Redis before scaling out |
| No CSRF token | Cross-site POSTs rely on `SameSite=Lax` and JSON-only bodies | Keep cookies same-site; add tokens before relaxing |
| SMTP failures are logged only | Users may not receive verification or reset mail | Monitor logs; add a retry queue before launch |
| No email change or account deletion API | Users cannot change the login email | Out of scope for Phase 2; add with re-verification |
| No upload endpoint / key validation | Path traversal once implemented | Validate keys at the storage boundary |
| No S3 adapter | Disk-only storage | Local storage only; do not claim S3 support yet |
| No antivirus/content checks | Malicious uploads | Add scanning before processing user media |
| Worker stub marks jobs complete | False success signals | Do not enable uploads until the real processor exists |
| Readiness exposes dependency latency/errors | Minor information disclosure | Restrict probe endpoints at the proxy if needed |
