# ViralClip AI

AI-powered YouTube Shorts creation platform. **Phase 1: foundation and architecture.** Services,
contracts, queue, database, and health checks are wired; features are intentionally deferred.

## Stack

Next.js + React + TypeScript + Tailwind + Zustand · Express + TypeScript · FastAPI · MySQL 8 +
InnoDB · Redis + BullMQ · FFmpeg/FFprobe · Docker Compose.

## Quick start

```bash
cp .env.example .env
npm install
npm run infra:up        # MySQL 8.4 + Redis 7.4
npm run db:migrate
npm run dev             # API :4000, worker :4001, web :3000
npm run dev:ai          # FastAPI :8000 (activate services/ai/.venv first)
```

Open <http://localhost:3000>. The dashboard runs `/api/v1/health/ready` and shows MySQL/Redis
connectivity.

Prerequisites, AI engine setup, and troubleshooting: [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md).

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

```bash
services/ai/.venv/Scripts/python.exe -m pytest services/ai/tests
```

## Layout

```
apps/web      Next.js frontend
apps/api      Express modular monolith (migrations, queue producer)
apps/worker   BullMQ consumer + media tooling
packages/shared  Types, queue names, job payloads
services/ai   FastAPI AI engine
docs/         Architecture, database, flow, workflow, security
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Project structure](docs/PROJECT_STRUCTURE.md)
- [Database](docs/DATABASE.md)
- [System flow](docs/SYSTEM_FLOW.md)
- [Development workflow](docs/DEVELOPMENT_WORKFLOW.md)
- [Security](docs/SECURITY.md)

## Phase 1 boundaries

The API never processes media. `POST /api/v1/videos` persists metadata and enqueues a job; the
worker processor is a logging stub marked `shortcut:` in code. Upload, auth, transcription, clip
selection, rendering, S3, and application Dockerfiles are Phase 2.
