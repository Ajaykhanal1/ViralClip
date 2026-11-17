# Development workflow

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | >= 22.12 | API, worker, web |
| npm | >= 10 | workspaces |
| Python | >= 3.11 | AI engine |
| Docker + Compose | current | MySQL + Redis (or install them locally) |
| FFmpeg + FFprobe | current | worker media steps; Phase 1 only checks presence |

## First-time setup

```bash
# 1. Configuration (repo root)
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

# 2. JS dependencies (also builds packages/shared)
npm install

# 3. Infrastructure
npm run infra:up              # MySQL 8.4 + Redis 7.4
docker compose ps             # wait for both to be healthy

# 4. Schema
npm run db:migrate
npm run db:status

# 5. AI engine (one-time)
cd services/ai
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux
pip install -r requirements-dev.txt
cd ../..
```

The repo reads one `.env` at the root. API, worker, and the Next.js config load it explicitly; the
AI engine does the same through pydantic-settings. `.env` is gitignored.

## Running services

Use two or three terminals, or one terminal with `npm run dev` plus another for AI:

```bash
npm run dev        # API :4000, worker :4001, web :3000
npm run dev:ai     # FastAPI :8000 (activate the venv first)
```

Individual processes:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
npm run dev:ai
```

## Verify the foundation

```bash
curl.exe http://localhost:4000/api/v1/health
curl.exe http://localhost:4000/api/v1/health/ready
curl.exe http://localhost:4001/health
curl.exe http://localhost:8000/api/v1/health
```

Open <http://localhost:3000>. The service panel runs the readiness probe in the browser; MySQL and
Redis should show `reachable`.

Readiness success:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "checks": {
      "mysql": { "status": "up", "latencyMs": 3 },
      "redis": { "status": "up", "latencyMs": 2 }
    }
  }
}
```

If MySQL or Redis is down, the endpoint returns `503` with `error.code = "NOT_READY"` and keeps
running.

## Command reference

| Command | Action |
| --- | --- |
| `npm run dev` | API + worker + web concurrently |
| `npm run dev:api` / `dev:worker` / `dev:web` / `dev:ai` | One service |
| `npm run build` | Build shared → API → worker → web |
| `npm run start:api` / `start:worker` / `start:web` | Run built JS |
| `npm run typecheck` | Build shared, then `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint flat config over the repo |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Node test runner in workspaces that define tests |
| `npm run db:migrate` / `db:status` | Apply / inspect SQL migrations |
| `npm run infra:up` / `infra:down` / `infra:logs` | Docker Compose for MySQL + Redis |

Python checks:

```bash
services/ai/.venv/Scripts/python.exe -m pytest services/ai/tests
services/ai/.venv/Scripts/python.exe -m ruff check services/ai/app services/ai/tests
services/ai/.venv/Scripts/python.exe -m ruff format --check services/ai/app services/ai/tests
```

## Day-to-day rules

1. **HTTP handlers do not process media.** Persist, enqueue, return. Put FFmpeg/AI work in
   `apps/worker`.
2. **Never store binaries in MySQL.** Use `storageKey`.
3. **Validate at boundaries.** Env via zod/pydantic; request bodies via zod in `*.schemas.ts`.
4. **Expected failures use `AppError`** with a stable `code`; unknown errors become a generic 500.
5. **Schema changes are new migration files.** Never edit an applied migration (checksums enforce
   this).
6. **Shared contracts** (queue names, job payloads, API types) go in `packages/shared`. Rebuild with
   `npm run build -w @viralclip/shared` when changing it during a long dev session.
7. **Parameterized SQL only.**
8. Keep `/api/v1` as the only business prefix.

## Adding a feature module (backend)

```
apps/api/src/modules/<name>/
├── <name>.schemas.ts     # zod request schemas + inferred types
├── <name>.repository.ts  # SQL only
├── <name>.service.ts     # use case, AppError
└── <name>.routes.ts      # Router, HTTP only
```

Mount it in `apps/api/src/app.ts`:

```ts
apiRouter.use('/<name>', nameRouter);
```

Add tests beside the code as `*.test.ts` (Node's test runner, executed with `tsx`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:3306` | `npm run infra:up`; or point `DB_PORT` at a local MySQL |
| `ER_ACCESS_DENIED_ERROR` | Credentials in `.env` must match `DB_USER`/`DB_PASSWORD` created in MySQL |
| Readiness: Redis down | Redis not running or `REDIS_URL` wrong. Start Compose or local Redis |
| Worker logs queue errors | BullMQ needs Redis; `ioredis` is installed—check `REDIS_URL` and that Redis is running |
| `docker: command not found` | Install Docker Desktop, or run MySQL/Redis natively |
| Env change ignored | Restart the process. Next.js inlines `NEXT_PUBLIC_*` at build/start |
| Port already in use | Change `API_PORT`/`WORKER_HEALTH_PORT`, or stop the other process |
| FFmpeg warning in worker | Add FFmpeg/FFprobe to `PATH`; Phase 1 continues without them |
| Migration checksum mismatch | An applied file was edited. Restore it and add a new migration instead |

## Phase boundary

Phase 1 ends at infrastructure, contracts, and health checks. Do not implement upload,
transcription, clip scoring, rendering, or auth until Phase 2 starts; the stub worker and the
`shortcut:` comments mark deliberate gaps.
