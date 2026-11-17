# ViralClip AI — Architecture

Phase 1 establishes the technical foundation only. Application features (upload, transcription,
clip selection, rendering) are Phase 2.

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
  │                       transcription / scoring (Phase 2)
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
| Shared | `packages/shared` | — | API types, queue names, job payloads, Redis URL parsing |

## Backend: modular monolith

One deployable API process, organized by feature module:

```
apps/api/src/
├── config/           validated env + pino logger
├── db/               mysql2 pool, migration runner
├── http/             error envelope, response helpers
├── modules/
│   ├── health/       liveness + readiness
│   └── videos/       routes → service → repository
├── queue/            BullMQ producer + Redis health check
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
| POST | `/api/v1/videos` | Register video metadata and enqueue a pipeline job (`202`) |

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

The Phase 1 processor is intentionally a logging stub. It returns success without producing clips
(marked with a `shortcut:` comment in code). Real processing is Phase 2.

## Data ownership

- MySQL stores users, projects, video metadata, clip metadata, and storage keys.
- **Video binaries are never stored in MySQL.** Only `storage_key` values are stored.
- Redis holds queue state, not durable business data.
- Local storage: `LOCAL_STORAGE_DIR` (default `./storage`, gitignored).
- S3-compatible storage: environment variables are defined; the adapter is Phase 2.

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
6. **Fail-open health for the API.** If Redis is down the API still starts and reports `degraded`
   from `/api/v1/health/ready`; queue-producing routes then fail with a clear error.

## Deferred to Phase 2

- Upload endpoint and storage adapters (local exists as a path convention, S3 adapter not written)
- Auth (users/projects currently have no API)
- Transcription, clip selection, scoring, rendering, status updates
- Worker progress reporting and DB status transitions
- Dockerfiles for application services (Compose currently provisions MySQL + Redis only)
- Rate limiting, upload scanning, signed URL policy
