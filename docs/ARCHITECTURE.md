# ViralClip AI — Architecture

Phase 1 established the technical foundation. Phase 2 adds accounts, sessions, and authorization;
upload, transcription, clip selection, and rendering remain deferred.

## System shape

```
Browser
  │
  ▼
apps/web (Next.js, :3000)
  │  HTTP /api/v1
  ▼
apps/api (Express, :4000) ──────────────► MySQL 8 (:3306)
  │  enqueue (BullMQ)                        metadata only
  ▼
Redis (:6379)
  │
  ▼
apps/worker (Node.js) ──► services/ai (FastAPI, :8000)
  │                       transcription / scoring (later)
  ├──► FFmpeg / FFprobe (local binary)
  └──► local storage (dev) / S3 (production)
```

The API never runs FFmpeg, AI inference, or long jobs inside a request handler. It validates,
persists metadata, and enqueues work.

## Components

| Component | Location | Port | Responsibility |
| --- | --- | --- | --- |
| Web | `apps/web` | 3000 | UI, Zustand state, calls `/api/v1` |
| API | `apps/api` | 4000 | Versioned REST API, validation, persistence, queue producer |
| Worker | `apps/worker` | 4001 (health only) | Consumes BullMQ jobs, media + AI orchestration |
| AI engine | `services/ai` | 8000 | Python/FastAPI service for AI tasks |
| MySQL | Docker Compose | 3306 | Relational metadata, InnoDB, utf8mb4 |
| Redis | Docker Compose | 6379 | BullMQ queue backend |
| Shared | `packages/shared` | - | API types, auth cookies, queue names, job payloads, Redis URL parsing |

## Backend: modular monolith

One deployable API process, organized by feature module:

```
apps/api/src/
├── config/           validated env + pino logger
├── db/               mysql2 pool, migration runner
├── http/             error envelope, response helpers
├── modules/
│   ├── auth/         routes → service → repository, cookies, tokens, mail
│   ├── health/       liveness + readiness
│   └── videos/       routes → service → repository
├── queue/            BullMQ producer + Redis health check
├── types/            Express request augmentation (`req.user`)
└── utils/
```

Rules:

- `routes` handles HTTP only (parse, call service, respond).
- `services` contains use cases and throws `AppError` for expected failures.
- `repositories` contain SQL and row-to-object mapping. Parameterized queries only.
- Cross-module imports go through a module's service, not its repository.
- New modules follow the `videos` folder shape (`*.routes.ts`, `*.service.ts`,
  `*.repository.ts`, `*.schemas.ts`).

`packages/shared` holds contracts used by more than one app. It is compiled to `dist` and built on
`npm install` and before `typecheck`/`build`.

## API surface and versioning

All business routes are mounted under `/api/v1` via `API_PREFIX` from `@viralclip/shared`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Unversioned liveness alias for probes, no envelope |
| GET | `/api/v1/health` | Liveness, success envelope |
| GET | `/api/v1/health/ready` | MySQL + Redis check, `200` or `503` |
| POST | `/api/v1/auth/register` | Create an account, start a session, send a verification email |
| POST | `/api/v1/auth/login` | Verify credentials and start a session |
| POST | `/api/v1/auth/refresh` | Rotate the refresh token and issue a new access token |
| POST | `/api/v1/auth/logout` | Revoke the current refresh token and clear cookies |
| GET | `/api/v1/auth/me` | Current user (requires auth) |
| PATCH | `/api/v1/auth/me` | Update display name (requires auth) |
| PATCH | `/api/v1/auth/me/password` | Change password, revoke all sessions (requires auth) |
| POST | `/api/v1/auth/forgot-password` | Send a reset link when the email exists |
| POST | `/api/v1/auth/reset-password` | Consume a single-use reset token |
| POST | `/api/v1/auth/verify-email` | Consume a single-use verification token |
| POST | `/api/v1/auth/resend-verification` | Send a new verification email (requires auth) |
| GET | `/api/v1/auth/users` | Paginated user list (requires `admin`) |
| POST | `/api/v1/videos` | Register video metadata and enqueue a job (requires auth, checks project ownership, `202`) |

Responses:

```json
{ "success": true, "data": { }, "requestId": "uuid" }
```

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] }, "requestId": "uuid" }
```

Future breaking changes get a new prefix (`/api/v2`). Additive changes stay in `v1`.

## Queue and worker boundary

- Queue name: `video-pipeline` (`QUEUE_NAMES.videoPipeline`).
- Job name: `process-video`.
- Payload: `VideoPipelineJob` (`videoId`, `projectId`, `storageKey`, `requestedAt`).
- Defaults: 3 attempts, exponential backoff starting at 5s, completed jobs kept 24h / 1000,
  failed jobs kept 7 days.
- Worker concurrency: `WORKER_CONCURRENCY` (default 2).
- The worker verifies FFmpeg/FFprobe at startup and warns, rather than crashing, if absent.

The current processor is intentionally a logging stub. It returns success without producing clips
(marked with a `shortcut:` comment in code). Real processing is a later phase.

## Authentication and sessions

- Passwords are bcrypt hashes (cost 12). The API never returns hashes or refresh tokens in JSON.
- Access token: HS256 JWT in the HTTP-only `vc_access` cookie, 15 minutes by default.
- Refresh token: random opaque token in the HTTP-only `vc_refresh` cookie, 30 days by default. Only
  its SHA-256 hash is stored. Each refresh rotates the token; reuse of a revoked token revokes every
  session for that user.
- Reset and verification tokens are random, single-use, hashed in the database, and expire after
  1 hour and 24 hours respectively.
- Cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`. `AUTH_COOKIE_DOMAIN`
  supports a shared parent domain when web and API are hosted separately.
- `requireAuth` verifies the access cookie (or a Bearer token) on protected routes. `requireRole`
  gates admin endpoints. `POST /api/v1/videos` verifies the project belongs to the caller.
- The web app's `proxy.ts` performs an optimistic check for `/settings/*` and signed-in visitors to
  the auth pages. Every API route still enforces auth; the proxy is not an authorization boundary.
- Registration and login are rate limited. Duplicate emails return `409 EMAIL_TAKEN`; login
  compares against a dummy hash for unknown emails to reduce timing leaks.

## Data ownership

- MySQL stores users, password hashes, hashed session/recovery tokens, projects, video metadata,
  clip metadata, and storage keys.
- **Video binaries are never stored in MySQL.** Only `storage_key` values are stored.
- Redis holds queue state, not durable business data.
- Local storage: `LOCAL_STORAGE_DIR` (default `./storage`, gitignored).
- S3-compatible storage: environment variables are defined; the adapter is a later phase.

## Key decisions and trade-offs

1. **Modular monolith over microservices.** One API deployable, clear module boundaries, one
   database. Splitting later is possible without rewriting call sites, because modules communicate
   through services.
2. **Separate Python service.** AI/ML dependencies evolve faster than the Node stack; a process
   boundary keeps images and runtimes independent.
3. **Raw `mysql2` + SQL migrations, no ORM.** Explicit SQL, no schema drift, small dependency
   surface. Cost: mapping code and hand-written queries.
4. **BullMQ.** Retries, backoff, job retention, and concurrency without custom queue code.
5. **Shared contract package.** Queue names and API types cannot silently drift between producer
   and consumer.
6. **Dual-token sessions.** Short-lived JWT access cookies keep middleware checks cheap, while
   opaque refresh tokens support server-side revocation, rotation, and theft detection. Cost: a
   refresh request when the access token expires.
7. **Fail-open health for the API.** If Redis is down the API still starts and reports `degraded`
   from `/api/v1/health/ready`; queue-producing routes then fail with a clear error.

## Deferred to later phases

- Upload endpoint and storage adapters (local exists as a path convention, S3 adapter not written)
- Project and clip HTTP APIs (the `projects` table currently has no route)
- Transcription, clip selection, scoring, rendering, status updates
- Worker progress reporting and DB status transitions
- Dockerfiles for application services (Compose currently provisions MySQL + Redis only)
- Upload scanning and signed URL policy
- Distributed rate limiting, email delivery retries, and session/device management
