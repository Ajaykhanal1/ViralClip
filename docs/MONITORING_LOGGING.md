# Monitoring and logging

## Health endpoints

| Endpoint | Expected response | Used by |
| --- | --- | --- |
| `https://$DOMAIN/health` | API liveness (`200`) | uptime monitor, nginx healthcheck |
| `https://$DOMAIN/api/v1/health/ready` | `checks.mysql.status = up`, `checks.redis.status = up` | deployment verification, operator |
| `https://$DOMAIN/web-health` | web process liveness (`200`) | nginx healthcheck |
| `http://worker:4001/health` | worker process liveness | container healthcheck |
| `http://ai:8000/api/v1/health` | AI service liveness | container healthcheck |

`ready` returns `503` when MySQL or Redis is unreachable. Monitor it separately from liveness.

## Container health and restart policy

Every long-running production service in `docker-compose.prod.yml` has a healthcheck and
`restart: unless-stopped`. Database and queue dependencies use `depends_on: condition: service_healthy`.
Check status with:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --since 30m api worker ai
```

## Logs

All services use the `json-file` driver with `max-size=20m` and `max-file=5`, which bounds local disk
usage. For longer retention, ship logs to a central system (Loki, CloudWatch, etc.) with the Docker
driver or a log sidecar. Structured API/worker logs are JSON via pino and redact auth cookies,
passwords, and tokens. Request URLs and user IDs are still logged; apply your retention policy.

## What to alert on

- `ready` returning `503` for more than one minute.
- Any container in `unhealthy` or repeated `restarting` state.
- `5xx` rate above 1% for five minutes.
- Queue backlog growing or no worker activity for ten minutes (inspect BullMQ via Redis tooling).
- Disk usage above 80% on the host, especially Docker's data root and the storage volume.
- Certificate expiry less than 14 days away.

A Prometheus/Grafana stack is intentionally not bundled; use the health endpoints above with an
external uptime checker and the host's existing metrics agent.
