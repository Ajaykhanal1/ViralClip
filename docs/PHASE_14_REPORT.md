# Phase 14 — Testing, security, and performance review

Date: 2026-11-20

## Scope

Added and executed unit/integration tests across the web, API, worker, and AI service; reviewed the
main trust boundaries and hot paths; fixed root causes found by those tests. No feature was disabled
or excluded to make a test pass.

## Verification results

| Check | Result |
| --- | --- |
| `npm test` | Pass — API 33, web 18, worker 20 (71 Node tests total) |
| `python -m pytest -q services/ai/tests` | Pass — 16 tests |
| `npm run typecheck` | Pass |
| `npm run build` | Pass — shared, API, worker, Next.js production build (21 routes) |
| `python -m ruff check services/ai` | Pass |
| `npm run lint` | Fails — 32 pre-existing errors (mostly `no-explicit-any`, unused imports, and legacy `react-hooks/exhaustive-deps` comments). No new error was introduced by the Phase 14 test/config changes. |
| `npm run format:check` | Fails — 101 pre-existing Prettier violations across the repo. Not reformatted wholesale to avoid unrelated churn. |
| FFmpeg render integration | Pass — real MP4 encode with audio, aspect ratio, failed-render cleanup, and retry |

`ffmpeg` is available locally; Docker, MySQL CLI, and Redis CLI are not. Live DB/Redis integration,
browser E2E against the full stack, and S3/YouTube network flows were therefore not executed here.

## Tests added

- **Frontend (Vitest + RTL + jsdom):** auth form validation/state, route protection, editor store
  mutations, responsive dashboard layout.
- **API (node:test):** CSRF origin handling, storage-key containment, upload content/type checks,
  encrypted OAuth token tamper detection, plus the existing auth/queue/rights/limit suites.
- **AI (pytest):** health without secrets, production service-token enforcement, path traversal
  rejection, malformed transcript handling, timestamp validation, error serialization.
- **Worker (node:test):** real FFmpeg render/audio/aspect-ratio/retry, crop planning, SRT timing,
  render args, AI segment normalization, resumable downloads, error classification.

## Security review

| Area | Finding / action |
| --- | --- |
| SQL injection | All reviewed repository queries use parameterized statements. No string-concatenated SQL found. |
| XSS | React/Next.js escaping is used for rendered text; no `dangerouslySetInnerHTML` added. |
| CSRF | **Fixed.** Cookie-auth write requests are now rejected on cross-site `Origin` headers; safe methods, bearer clients, and same-origin writes pass. |
| Access control | Ownership checks covered by existing tests; route protection covered by frontend and API tests. |
| Uploads | MIME/content mismatch and unsupported files are rejected; max size is enforced. |
| Path traversal | **Fixed.** AI transcription storage keys must resolve inside the configured storage root. API upload keys are also containment-checked. |
| Token leakage | **Fixed.** Raw upload tokens moved from query strings to the `x-upload-token` header so they are not logged in URLs or browser history. |
| Rate limiting | Registration rate limiting retained and tested; no limiter was disabled. |
| Secrets | AI service token is required in production; API/web secrets remain env-driven with dev-only fallbacks. Rotate real values before production. |
| Queue security | Job payloads remain typed contracts in `packages/shared`; worker rejects cancelled jobs and classifies auth/quota failures distinctly. |
| AI input validation | **Fixed.** Invalid Pydantic errors are serialized as JSON instead of leaking exception objects; transcript segments with invalid timestamps are rejected. |

## Performance review

- Next.js build prerenders 19 static routes; dynamic routes stay on demand. No build-time regression.
- API queries use the existing migration indexes; no duplicate indexes were added.
- Worker rendering uses `libx264 -preset veryfast -crf 20`, `yuv420p`, and `+faststart`; crop/scale/pad
  avoid upscaling beyond the output box. Concurrency is already configurable through
  `WORKER_CONCURRENCY`.
- Real FFmpeg integration proves the 9:16 render path works on this machine (about 1s for a 1.5s
  synthetic clip). Large-timeline benchmarks under load were not run because MySQL/Redis are
  unavailable here.
- No storage-driver benchmark was run. `STORAGE_DRIVER=s3` is documented but no S3 adapter is
  implemented; production storage must use local persistent storage until that adapter exists.

## Bugs fixed

1. **Real render failure:** FFmpeg filtergraph commas inside `min(...)` were splitting the chain;
   escaped them in `planCrop`. Removed incorrect quoting around crop x/y expressions. Verified with
   a real encode.
2. **Word timestamp corruption:** word times were clamped only to source duration, so a word could
   land outside its parent segment; they are now clamped to segment start/end. `NaN` timestamps fall
   back to the segment boundary.
3. **AI path traversal:** `Path.is_relative_to` now enforces storage-root containment.
4. **Unauthenticated AI service in production:** middleware requires `x-ai-service-token`; the
   worker sends it when configured.
5. **CSRF on cookie-auth writes:** `Origin` guard added to the API.
6. **Upload token in URL:** raw upload token moved to a request header; web client updated.
7. **Invalid AI validation errors:** Pydantic errors converted to plain JSON values before
   serialization.

## Remaining risks

- Full-stack E2E and live DB/Redis behavior are unverified in this environment.
- Whisper runtime is not installed here; transcription tests cover failure paths, not real speech.
- S3 storage driver is configured but not implemented; YouTube network publishing was not exercised.
- Existing lint/format debt remains (32 lint errors, 101 format warnings).
- No load test was performed; queue throughput and large-timeline memory use are unmeasured.
- Secrets are still development placeholders in `.env.example`; they must be replaced for production.

## Production readiness

**Not ready for production.** Unit/integration coverage and the real FFmpeg render path are green,
but the stack has not been started with real MySQL/Redis, no browser E2E has run, and deployment
infrastructure is still pending Phase 15. Complete Phase 15, then run the documented production
flow validation on a real host before declaring the system production-ready.
