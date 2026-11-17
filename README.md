# ViralClip AI

AI-powered YouTube Shorts creation platform. **Phase 2: accounts and access.** Registration, login,
email verification, password recovery, profile settings, sessions, and role checks are implemented.
Media features are intentionally deferred.

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

Open <http://localhost:3000>. Create an account at `/register`, then use `/settings/profile` to
update your name, confirm your email, or change your password. The dashboard still runs
`/api/v1/health/ready` and shows MySQL/Redis connectivity.

Without `SMTP_HOST`, development logs verification and password-reset links to the API console
instead of sending email.

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

## Phase boundaries

Authentication is real: HTTP-only cookies, short-lived access tokens, rotating refresh tokens,
hashed passwords, and ownership checks on the video endpoint. The API still never processes media.
`POST /api/v1/videos` requires a signed-in user and persists metadata before enqueueing a job; the
worker processor is a logging stub marked `shortcut:` in code. Upload, transcription, project
management, clip selection, rendering, S3, and application Dockerfiles remain for later phases.
