#!/usr/bin/env bash
#
# Stop the local stack. Pass --volumes to also delete data (clean slate).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [ "${1:-}" = "--volumes" ] || [ "${1:-}" = "-v" ]; then
  echo "[dev:down] stopping containers and removing volumes (pgdata, redisdata, ipfsdata, studio-pgdata, ...)"
  docker compose --profile infra --profile edge --profile app down --volumes --remove-orphans
  docker compose -f docker-compose.studio.yml down --volumes --remove-orphans || true
  rm -f packages/contracts/.contracts-state.json
else
  echo "[dev:down] stopping containers (data volumes preserved)"
  docker compose --profile infra --profile edge --profile app down --remove-orphans
  docker compose -f docker-compose.studio.yml down --remove-orphans || true
fi
