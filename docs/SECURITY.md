# Security

Phase 1 has no authentication yet. The controls below are what the foundation actually implements;
the gaps are listed explicitly so Phase 2 does not assume protection that is not there.

## Implemented controls

### Configuration and secrets

- One gitignored `.env`; `.env.example` contains development defaults only.
- API and worker validate environment variables with zod at startup; the AI engine uses
  pydantic-settings. Invalid values stop the process instead of failing later.
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

- `npm audit` reports 0 known vulnerabilities for the installed tree at Phase 1 completion.
- The `package-lock.json` lockfile is kept for reproducible installs.

## Production checklist (before exposing the API)

### Must do in Phase 2

- Authentication and authorization on every business route; ownership checks on projects, videos,
  and clips (IDOR is the obvious risk otherwise).
- Rate limiting and request size limits at the edge (reverse proxy or `express-rate-limit`).
- Upload hardening: MIME sniffing, extension allowlist, maximum size/duration, ffprobe validation,
  malware scanning, and 9:16 render limits.
- Storage abstraction: S3 adapter with presigned PUT/GET URLs, server-side encryption, private
  buckets, short expirations, and storage-key sanitization (no `..`, no absolute paths).
- Idempotent workers and an outbox/reconciler for the insert-then-enqueue gap.
- CSRF protection if cookie-based sessions are introduced.
- Strict CSP for the web app (Next.js currently ships default headers only).
- Redis authentication/TLS and network isolation.
- MySQL TLS, dedicated least-privilege users, automated backups, restore drills.

### Deployment baseline

- Never publish MySQL (`3306`) or Redis (`6379`) outside a private network. The current Compose
  file publishes them for local development only; override or remove those mappings in production.
- Put the API behind TLS termination, set `NODE_ENV=production`, and use a secret manager rather
  than a `.env` file.
- Run containers as non-root with read-only filesystems where possible; application Dockerfiles are
  not part of Phase 1.
- Centralize logs with retention, access control, and PII review. Request bodies are not logged, but
  URLs and user-supplied IDs are.
- Add dependency and container scanning to CI.

## Known gaps at Phase 1

| Gap | Risk | Guardrail |
| --- | --- | --- |
| No auth | Anyone who can reach the API can insert video metadata | Keep API local until Phase 2 auth lands |
| No rate limiting | Queue flooding | Local-only binding; add edge limits before exposure |
| No upload endpoint / key validation | Path traversal once implemented | Validate keys at the storage boundary in Phase 2 |
| No S3 adapter | Disk-only storage | Local storage only; do not claim S3 support yet |
| No antivirus/content checks | Malicious uploads | Add scanning before processing user media |
| Worker stub marks jobs complete | False success signals | Do not enable uploads until the real processor exists |
| Readiness exposes dependency latency/errors | Minor information disclosure | Restrict probe endpoints at the proxy if needed |
