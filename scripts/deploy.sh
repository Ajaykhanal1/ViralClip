#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

test -f .env || { echo ".env is required" >&2; exit 1; }

COMPOSE=(docker compose -f docker-compose.prod.yml)
"${COMPOSE[@]}" config --quiet

DOMAIN_VALUE="$(grep -E '^DOMAIN=' .env | head -n 1 | cut -d= -f2- | tr -d '\"' || true)"
: "${DOMAIN_VALUE:?set DOMAIN in .env}"

"${COMPOSE[@]}" build
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --remove-orphans

BASE_URL="https://${DOMAIN_VALUE}" node scripts/verify-production-flow.mjs
