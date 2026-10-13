#!/usr/bin/env bash
#
# One-command local bring-up (SRS §9.1).
#
#   1. ensure .env + development TLS certificate exist
#   2. start the infra services (postgres, redis, ipfs) and the edge
#   3. wait for readiness
#   4. apply Prisma migrations, then the RLS policies/grants
#   5. use the already-deployed Avalanche Fuji AssetLicenseRegistry address
#
# Afterwards run `pnpm dev` for api/worker/web in watch mode.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

info() { printf '\033[1;36m[dev:up]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[dev:up]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[dev:up]\033[0m %s\n' "$*" >&2; exit 1; }

# --- 1. environment file ----------------------------------------------------
if [ ! -f .env ]; then
  info "creating .env from .env.example"
  cp .env.example .env
fi

# Make the chain settings available to the explicit Fuji validation below as well as to Compose.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

if [ ! -f docker/certs/void-space.crt ]; then
  info "generating development TLS certificate"
  bash docker/scripts/gen-dev-certs.sh
fi

# --- 2. containers ----------------------------------------------------------
info "starting VOID·SPACE infra + edge (postgres, redis, ipfs, nginx)"
docker compose --profile infra --profile edge up -d

info "starting VOID·STUDIO infra + edge (studio-postgres, studio-redis, studio-ipfs, studio-nginx)"
docker compose -f docker-compose.studio.yml up -d

# --- 3. readiness -----------------------------------------------------------
wait_for_service() {
  local service="$1" probe="$2" attempts="${3:-60}"
  info "waiting for ${service} to become ready"
  for _ in $(seq 1 "${attempts}"); do
    if docker compose exec -T "${service}" sh -c "${probe}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  docker compose logs --tail=40 "${service}" || true
  fail "${service} did not become ready in time"
}

wait_for_studio_service() {
  local service="$1" probe="$2" attempts="${3:-60}"
  info "waiting for studio ${service} to become ready"
  for _ in $(seq 1 "${attempts}"); do
    if docker compose -f docker-compose.studio.yml exec -T "${service}" sh -c "${probe}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  docker compose -f docker-compose.studio.yml logs --tail=40 "${service}" || true
  fail "${service} did not become ready in time"
}

wait_for_service postgres "pg_isready -U ${POSTGRES_USER:-voidspace} -d ${POSTGRES_DB:-voidspace}"
wait_for_service redis "redis-cli ping"
wait_for_studio_service studio-postgres "pg_isready -U ${STUDIO_POSTGRES_USER:-voidstudio} -d ${STUDIO_POSTGRES_DB:-voidstudio}"
wait_for_studio_service studio-redis "redis-cli ping"

# --- 4. databases -----------------------------------------------------------
info "generating VOID·SPACE Prisma client"
pnpm --silent db:generate

info "applying VOID·SPACE database migrations"
pnpm --silent db:migrate

info "applying VOID·SPACE Row-Level Security policies and grants"
pnpm --silent db:rls

info "generating VOID·STUDIO Prisma client"
pnpm --silent studio:db:generate

info "applying VOID·STUDIO database migrations"
pnpm --silent studio:db:migrate

info "applying VOID·STUDIO Row-Level Security policies and grants"
pnpm --silent studio:db:rls

# --- 5. Avalanche Fuji contract --------------------------------------------
if [ -z "${CHAIN_RPC_URL:-}" ] || [ -z "${CONTRACT_ADDRESS:-}" ]; then
  warn "Avalanche Fuji contract is not configured. Set CHAIN_RPC_URL and CONTRACT_ADDRESS in .env."
  warn "Deploy once with: pnpm contracts:deploy:fuji"
else
  info "using AssetLicenseRegistry on Avalanche Fuji at ${CONTRACT_ADDRESS}"
fi

cat <<'EOF'

  ✔ local stack is up (VOID·SPACE & VOID·STUDIO).

    next:  pnpm dev         # starts VOID·SPACE + VOID·STUDIO together in watch mode
           pnpm db:seed     # demo tenant, users and sample assets

    VOID·SPACE:
      web:   http://localhost:3000   (or https://localhost)
      api:   http://localhost:4000   (or https://localhost/api/v1/health)
      ipfs:  http://localhost:8080/ipfs/<cid>

    VOID·STUDIO:
      web:   http://localhost:5007   (or https://localhost:8443)
      api:   http://localhost:4100/studio/api/v1/health

EOF
