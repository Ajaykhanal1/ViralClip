#!/usr/bin/env bash
set -euo pipefail

echo "AUTH_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "YOUTUBE_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "AI_SERVICE_TOKEN=$(openssl rand -hex 32)"
echo "SERVICE_TOKEN=$(openssl rand -hex 32)"
echo "MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)"
echo "DB_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
