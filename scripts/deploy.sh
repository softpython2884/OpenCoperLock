#!/usr/bin/env bash
#
# Build & prepare OpenCoperLock for a bare-metal / PM2 deployment.
#
#   cp .env.example .env   # then edit secrets
#   ./scripts/deploy.sh
#   pm2 start ecosystem.config.cjs
#
# Re-run after every `git pull` to rebuild and apply new migrations.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

# Read a single value from .env WITHOUT sourcing it, so secrets containing shell
# metacharacters (spaces, $, backticks, quotes) are handled literally and safely.
read_env() {
  local key="$1" line val
  line="$(grep -E "^${key}=" .env | tail -1 || true)"
  val="${line#*=}"
  # strip one layer of surrounding quotes if present
  [[ "$val" == \"*\" ]] && val="${val:1:${#val}-2}"
  [[ "$val" == \'*\' ]] && val="${val:1:${#val}-2}"
  printf '%s' "$val"
}

# Export only what the build/migrate steps need (seed loads .env itself via dotenv).
export DATABASE_URL="$(read_env DATABASE_URL)"
export STORAGE_PATH="$(read_env STORAGE_PATH)"
export QUARANTINE_PATH="$(read_env QUARANTINE_PATH)"
[[ -n "$DATABASE_URL" ]] || { echo "ERROR: DATABASE_URL is not set in .env" >&2; exit 1; }

# The browser bundle needs the *public* API URL baked in at build time.
NEXT_PUBLIC_API_URL="$(read_env NEXT_PUBLIC_API_URL)"
: "${NEXT_PUBLIC_API_URL:=http://localhost:4000}"
export NEXT_PUBLIC_API_URL
echo "==> Building web with NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"

echo "==> Installing dependencies"
pnpm install --frozen-lockfile

echo "==> Building shared package"
pnpm --filter @opencoperlock/shared build

echo "==> Generating Prisma client"
pnpm --filter @opencoperlock/api prisma:generate

echo "==> Building API"
pnpm --filter @opencoperlock/api build

echo "==> Building web (Next standalone)"
pnpm --filter @opencoperlock/web build

# Make sure the database is reachable for migrate/seed. If it's a project-local cluster
# that isn't running yet (first install), start it temporarily; on a redeploy it's already
# up (PM2-managed) so we leave it alone.
db_reachable() {
  local hp="${DATABASE_URL#*@}"; hp="${hp%%/*}"
  local host="${hp%%:*}"; local port="${hp##*:}"
  [[ "$port" == "$host" ]] && port=5432
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null
}
STARTED_LOCAL_PG=false
if ! db_reachable; then
  if [[ -f .postgres/data/PG_VERSION ]]; then
    echo "==> Starting project-local PostgreSQL for setup"
    ./scripts/postgres-local.sh ctl-start
    STARTED_LOCAL_PG=true
  else
    echo "ERROR: the database in DATABASE_URL is not reachable, and no project-local" >&2
    echo "       cluster exists (.postgres/). Start your database or re-run the wizard." >&2
    exit 1
  fi
fi

echo "==> Applying database migrations"
pnpm --filter @opencoperlock/api prisma:migrate

echo "==> Seeding first admin (idempotent)"
pnpm --filter @opencoperlock/api db:seed

if [[ "$STARTED_LOCAL_PG" == true ]]; then
  echo "==> Stopping project-local PostgreSQL (PM2 will supervise it)"
  ./scripts/postgres-local.sh ctl-stop
fi

# Ensure storage directories exist and are writable by the current user.
mkdir -p "${STORAGE_PATH:-$ROOT/data/storage}" "${QUARANTINE_PATH:-$ROOT/data/quarantine}"

echo ""
echo "==> Done. Start (or reload) the processes with:"
echo "      pm2 start ecosystem.config.cjs   # first time"
echo "      pm2 reload ecosystem.config.cjs  # subsequent deploys"
