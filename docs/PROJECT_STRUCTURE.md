# Project structure

```
Viral Clip/
├── apps/
│   ├── api/                       Express + TypeScript backend (modular monolith)
│   │   ├── migrations/            Ordered, immutable SQL migrations
│   │   │   └── 001_init.sql
│   │   ├── src/
│   │   │   ├── app.ts             Express app: logging, CORS, routes, error handling
│   │   │   ├── server.ts          Process lifecycle, graceful shutdown
│   │   │   ├── config/
│   │   │   │   ├── env.ts         Zod-validated environment
│   │   │   │   └── logger.ts      pino logger
│   │   │   ├── db/
│   │   │   │   ├── mysql.ts       Connection pool + ping
│   │   │   │   ├── migrations.ts  Loader, checksums, runner
│   │   │   │   ├── migrate-cli.ts `db:migrate` / `db:status`
│   │   │   │   └── migrations.test.ts
│   │   │   ├── http/
│   │   │   │   ├── errors.ts      AppError, Zod/DB error mapping, 404 handler
│   │   │   │   └── respond.ts     Success envelope
│   │   │   ├── modules/
│   │   │   │   ├── health/        Liveness + readiness routes
│   │   │   │   └── videos/        Thin Phase 1 slice: persist metadata + enqueue job
│   │   │   ├── queue/
│   │   │   │   └── video.queue.ts BullMQ producer, Redis ping
│   │   │   └── utils/
│   │   │       └── with-timeout.ts
│   │   └── tsconfig.json
│   │
│   ├── web/                       Next.js App Router frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx       Phase 1 status dashboard
│   │   │   │   └── globals.css    Tailwind v4 + design tokens
│   │   │   ├── components/
│   │   │   │   ├── system-status.tsx
│   │   │   │   └── pipeline-timeline.tsx
│   │   │   ├── lib/api.ts         Readiness client
│   │   │   └── store/health-store.ts  Zustand store
│   │   ├── next.config.ts         Loads repo-root .env, inlines NEXT_PUBLIC_API_URL
│   │   ├── postcss.config.mjs
│   │   └── tsconfig.json
│   │
│   └── worker/                    BullMQ consumer + media tooling
│       ├── src/
│       │   ├── worker.ts          Startup, queue consumer, shutdown
│       │   ├── health.ts          :4001 liveness endpoint
│       │   ├── config/            env + logger
│       │   ├── media/ffmpeg.ts    FFmpeg/FFprobe availability probe
│       │   └── processors/
│       │       └── video-pipeline.ts  Phase 1 stub
│       └── tsconfig.json
│
├── packages/
│   └── shared/                    Types and constants shared by API, worker, web
│       └── src/index.ts           API envelopes, queue names, job payloads, Redis URL parser
│
├── services/
│   └── ai/                        Python FastAPI AI engine
│       ├── app/
│       │   ├── main.py            App factory, middleware, error envelopes, CORS
│       │   ├── api/routes/health.py
│       │   └── core/
│       │       ├── config.py      pydantic-settings, reads repo-root .env
│       │       └── logging.py     JSON logging
│       ├── tests/test_health.py
│       ├── requirements.txt
│       ├── requirements-dev.txt
│       └── pyproject.toml         pytest + ruff configuration
│
├── docs/                          Architecture and workflow documentation
│   ├── ARCHITECTURE.md
│   ├── PROJECT_STRUCTURE.md
│   ├── DATABASE.md
│   ├── SYSTEM_FLOW.md
│   ├── DEVELOPMENT_WORKFLOW.md
│   └── SECURITY.md
│
├── docker-compose.yml             MySQL 8.4 + Redis 7.4 with health checks
├── .env.example                   Single source of runtime configuration
├── .editorconfig
├── .prettierrc.json
├── eslint.config.mjs              Flat config for all TS/JS workspaces
├── tsconfig.base.json             Shared strict TypeScript settings
├── package.json                   npm workspaces + root scripts
└── README.md
```

Generated and ignored: `node_modules/`, `dist/`, `.next/`, `.venv/`, `.env`, `storage/`,
`__pycache__/`, logs.

## Workspace boundaries

| Workspace | Package name | Depends on |
| --- | --- | --- |
| `apps/api` | `@viralclip/api` | `@viralclip/shared` |
| `apps/worker` | `@viralclip/worker` | `@viralclip/shared` |
| `apps/web` | `@viralclip/web` | `@viralclip/shared` |
| `packages/shared` | `@viralclip/shared` | — |
| `services/ai` | — (not an npm workspace) | Python requirements |

`packages/shared` builds to `dist` before the apps consume it. `npm install` triggers the build
through the root `postinstall` script.

## Where new code goes

- New API feature: `apps/api/src/modules/<feature>/` with routes, schemas, service, repository.
- New background job type: add payload + queue name in `packages/shared`, producer in
  `apps/api/src/queue/`, processor in `apps/worker/src/processors/`.
- New AI capability: `services/ai/app/api/routes/`, business logic under `services/ai/app/`.
- New UI screen: `apps/web/src/app/<route>/`, shared components in `apps/web/src/components/`.
- Cross-cutting contract: `packages/shared/src/index.ts`.
- Schema change: a new SQL file in `apps/api/migrations/`.
