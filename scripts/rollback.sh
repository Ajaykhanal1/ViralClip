#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${1:?usage: scripts/rollback.sh <git-ref>}"
DOMAIN_VALUE="$(grep -E '^DOMAIN=' .env | head -n 1 | cut -d= -f2- | tr -d '\"' || true)"
: "${DOMAIN_VALUE:?set DOMAIN in .env}"

COMPOSE=(docker compose -f docker-compose.prod.yml)
CURRENT="$(git rev-parse HEAD)"

git fetch --all --tags --quiet
git checkout "$TARGET"
"${COMPOSE[@]}" build
"${COMPOSE[@]}" up -d --remove-orphans

if ! BASE_URL="https://${DOMAIN_VALUE}" node scripts/verify-production-flow.mjs; then
  echo "Rollback verification failed; restoring $CURRENT" >&2
  git checkout "$CURRENT"
  "${COMPOSE[@]}" build
  "${COMPOSE[@]}" up -d --remove-orphans
  exit 1
fi

echo "Rolled back to $TARGET. Database migrations are not reverted automatically."
