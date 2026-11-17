# System flow

## Implemented flows

### Accounts and sessions

```
POST /api/v1/auth/register
  ├─ zod validation, duplicate check
  ├─ bcrypt hash (cost 12)
  ├─ INSERT users, verification token (hashed), refresh token (hashed)
  ├─ send verification email (logged in development without SMTP)
  └─ 201 { user } + HttpOnly access/refresh cookies

POST /api/v1/auth/login
  ├─ lookup by email, bcrypt compare (dummy hash when absent)
  ├─ create refresh token, sign 15-minute access JWT
  └─ 200 { user } + rotated session cookies

POST /api/v1/auth/refresh
  ├─ hash refresh cookie, look up row
  ├─ revoked token → revoke every session for that user
  ├─ expired token → 401
  └─ revoke old row, issue new pair (rotation)

Protected request (for example GET /api/v1/auth/me)
  ├─ requireAuth verifies the access cookie or Bearer token
  ├─ missing/invalid → 401 UNAUTHORIZED
  └─ service resolves the user by id from the token, never from the request body
```

Password reset and email verification use single-use tokens from email links. The web pages at
`/reset-password` and `/verify-email` submit the token to the API; the token is hashed and checked
for expiry and prior use.

### Video metadata

The only other business endpoint is metadata registration. It exists to prove the API → MySQL →
Redis → worker path; it does not process media.

```
POST /api/v1/videos (requires auth)
  │
  ├─ Express + pino request id
  ├─ requireAuth → user id from access token
  ├─ zod validation
  ├─ SELECT project owner; missing or foreign → 404 PROJECT_NOT_FOUND
  ├─ INSERT INTO videos (status = 'uploaded')
  ├─ BullMQ add "process-video" to "video-pipeline"
  └─ 202 { video, jobId }
        │
        ▼
     Redis queue
        │
        ▼
     worker (concurrency 2)
        ├─ logs payload (current stub)
        └─ marks job completed
```

Example request:

```json
{
  "projectId": 1,
  "originalFilename": "podcast-episode.mp4",
  "storageKey": "videos/podcast-episode.mp4",
  "mimeType": "video/mp4",
  "sizeBytes": 734003200,
  "durationSeconds": 3600
}
```

The caller must own an existing project (directly in MySQL until a project API exists). Bucket/path
conventions are not enforced yet; `storageKey` is unique.

## Target flow (later phases)

1. `POST /api/v1/videos/upload` — short-lived storage credentials or local multipart upload.
   The API writes metadata, never media bytes into MySQL.
2. API enqueues `process-video` with the storage key.
3. Worker downloads the source, runs `ffprobe` for duration/streams, and updates video status.
4. Worker calls the AI engine for transcription and highlight candidates.
5. Worker cuts candidate clips with FFmpeg, renders 9:16 output, uploads to storage.
6. Worker writes clip rows (`pending` → `processing` → `ready`/`failed`) and scores.
7. Web polls or subscribes to status, then previews and exports.

No step 3–7 work runs in an HTTP handler.

## Request lifecycle (API)

```
request
  → pino-http (assign/propagate x-request-id, log completion)
  → helmet (security headers)
  → cors (allowlist from CORS_ORIGINS)
  → express.json (1 MB limit)
  → /api/v1 router
      → route (parse with zod, requireAuth/requireRole where needed)
      → service (use case, ownership checks, AppError)
      → repository (parameterized SQL)
  → response envelope { success, data | error, requestId }
  → 404 handler for unmatched routes
  → error handler (ZodError → 400, AppError → its status, MySQL known codes → domain errors,
    everything else → 500 with a generic message)
```

## Health and readiness

| Endpoint | Checks | Failure behavior |
| --- | --- | --- |
| `GET /health` | none | 200 while process is alive |
| `GET /api/v1/health` | none | 200 while process is alive |
| `GET /api/v1/health/ready` | MySQL ping, Redis `INFO` with 2s timeout | 503 with per-dependency detail |
| `GET :4001/health` (worker) | none | 200 while worker process is alive |
| `GET :8000/health` (AI) | none | 200 while AI process is alive |

The API intentionally starts even if MySQL or Redis is unavailable, so the readiness probe can
report the failure instead of crash-looping. Requests that need a dependency fail with `500` or a
domain error.

Worker readiness is not tied to Redis; if Redis is down the worker logs errors and `/health` still
reports the process as alive. Queue metrics/monitoring are a later addition.

## Queue semantics

- Queue: `video-pipeline`; job: `process-video`.
- Retries: 3, exponential backoff starting at 5s.
- Completed jobs: removed after 24h or when 1000 accumulate.
- Failed jobs: kept for 7 days.
- Producer failure: if Redis is unavailable, `POST /api/v1/videos` returns `500` after the MySQL
  row is already inserted. There is no outbox pattern yet; a job reconciler or transactional
  outbox should close that gap.
- Worker crash mid-job: BullMQ's stalled-job handling re-delivers according to its lock settings.
  Future processors must be idempotent (upsert by video/storage key, not blind inserts).

## Status model

| Entity | Values | Current use |
| --- | --- | --- |
| project | `draft`, `processing`, `ready`, `failed` | Defaults to `draft` |
| video | `uploaded`, `processing`, `ready`, `failed` | Created as `uploaded`, never advanced |
| clip | `pending`, `processing`, `ready`, `failed` | No clips created |

Transitions belong to worker code, not HTTP handlers.

## Logging and tracing

- Every API request gets/propagates `x-request-id`; the same id is in response bodies (`requestId`),
  response headers, and pino logs.
- API/worker logs are JSON in production and pretty-printed only in a development TTY.
- Authorization headers, cookies, passwords, and tokens are redacted.
- The AI engine logs JSON and echoes/generates `x-request-id`.
- No distributed tracing (OpenTelemetry) yet.
