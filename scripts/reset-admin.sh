#!/usr/bin/env bash
#
# Reset (or create) an OpenCoperLock administrator's password — for when you're locked out
# (e.g. a typo in the password during setup). Lists existing admins, then prompts for an
# email and a new password. Works with the project-local PostgreSQL (started on demand).
#
#   ./scripts/reset-admin.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "ERROR: .env not found (run from the project, after setup)." >&2; exit 1; }

# Read a value from .env without sourcing it (safe with special characters).
read_env() {
  local key="$1" line val
  line="$(grep -E "^${key}=" .env | tail -1 || true)"
  val="${line#*=}"
  [[ "$val" == \"*\" ]] && val="${val:1:${#val}-2}"
  [[ "$val" == \'*\' ]] && val="${val:1:${#val}-2}"
  printf '%s' "$val"
}

export DATABASE_URL="$(read_env DATABASE_URL)"
[[ -n "$DATABASE_URL" ]] || { echo "ERROR: DATABASE_URL not set in .env" >&2; exit 1; }

# Ensure the database is reachable; start the project-local cluster if it isn't running.
db_reachable() {
  local hp="${DATABASE_URL#*@}"; hp="${hp%%/*}"
  local host="${hp%%:*}"; local port="${hp##*:}"
  [[ "$port" == "$host" ]] && port=5432
  (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null
}
STARTED_LOCAL_PG=false
if ! db_reachable; then
  if [[ -f .postgres/data/PG_VERSION ]]; then
    ./scripts/postgres-local.sh ctl-start >/dev/null
    STARTED_LOCAL_PG=true
  else
    echo "ERROR: the database is not reachable (is PM2 running it?)." >&2
    exit 1
  fi
fi
cleanup() { [[ "$STARTED_LOCAL_PG" == true ]] && ./scripts/postgres-local.sh ctl-stop >/dev/null 2>&1 || true; }
trap cleanup EXIT

run_node() { pnpm --filter @opencoperlock/api exec tsx scripts/reset-admin.ts; }

echo "Existing administrator accounts:"
RESET_LIST=1 run_node || true
echo ""

DEF_EMAIL="$(read_env ADMIN_EMAIL)"
read -r -p "Admin email to reset or create [${DEF_EMAIL}]: " EMAIL
EMAIL="${EMAIL:-$DEF_EMAIL}"
[[ -n "$EMAIL" ]] || { echo "ERROR: no email given." >&2; exit 1; }

PW=''
while :; do
  read -r -s -p "New password (min 12 chars): " PW; echo
  if [[ ${#PW} -lt 12 ]]; then echo "  Too short."; continue; fi
  read -r -s -p "Confirm password: " PW2; echo
  if [[ "$PW" != "$PW2" ]]; then echo "  Passwords do not match."; continue; fi
  break
done

CLEAR2FA=0
read -r -p "Also disable two-factor for this account? [y/N] " ans
[[ "$ans" =~ ^[Yy]$ ]] && CLEAR2FA=1

RESET_EMAIL="$EMAIL" RESET_PASSWORD="$PW" RESET_CLEAR_2FA="$CLEAR2FA" run_node

echo ""
echo "Done — sign in at your app URL with this email and the new password."
