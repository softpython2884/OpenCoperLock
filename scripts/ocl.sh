#!/usr/bin/env bash
#
# OpenCoperLock lifecycle control — one entry point to start / stop / restart the whole
# stack (project-local PostgreSQL, API and web) through PM2.
#
#   ./scripts/ocl.sh start      # start every process (or bring them back if stopped)
#   ./scripts/ocl.sh stop       # stop every process (cluster, API, web)
#   ./scripts/ocl.sh restart    # restart every process
#   ./scripts/ocl.sh reload     # zero-downtime reload (use after a redeploy)
#   ./scripts/ocl.sh status     # show the process table
#   ./scripts/ocl.sh logs [app] # tail logs (all, or one of: postgres|api|web)
#   ./scripts/ocl.sh update     # git pull + ./scripts/deploy.sh + reload
#   ./scripts/ocl.sh persist    # save the PM2 process list + enable boot startup
#
# Everything is driven by ecosystem.config.cjs, so the process set (whether a project-local
# PostgreSQL is supervised or an external database is used) is detected automatically.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ECOSYSTEM="$ROOT/ecosystem.config.cjs"

# Process names as declared in ecosystem.config.cjs.
APPS=(opencoperlock-postgres opencoperlock-api opencoperlock-web)

need_pm2() {
  command -v pm2 >/dev/null 2>&1 || {
    echo "ERROR: pm2 is not installed or not on PATH. Install it with: npm i -g pm2" >&2
    exit 1
  }
}

# Resolve a short app name (postgres|api|web) to its full PM2 process name.
full_name() {
  case "$1" in
    postgres|pg|db) echo "opencoperlock-postgres" ;;
    api)            echo "opencoperlock-api" ;;
    web|ui)         echo "opencoperlock-web" ;;
    *)              echo "$1" ;;
  esac
}

cmd="${1:-}"
shift || true

case "$cmd" in
  start)
    need_pm2
    # `pm2 start <ecosystem>` is idempotent: it launches missing apps and is a no-op for
    # ones already online. If they exist but are stopped, bring them back up too.
    echo "==> Starting OpenCoperLock"
    pm2 start "$ECOSYSTEM"
    pm2 start "${APPS[@]}" 2>/dev/null || true
    pm2 status
    ;;

  stop)
    need_pm2
    echo "==> Stopping OpenCoperLock"
    # Stop the API/web first, the database last, so in-flight requests aren't cut off from
    # their storage backend before they drain.
    pm2 stop opencoperlock-web opencoperlock-api 2>/dev/null || true
    pm2 stop opencoperlock-postgres 2>/dev/null || true
    pm2 status
    ;;

  restart)
    need_pm2
    echo "==> Restarting OpenCoperLock"
    # Ensure everything is defined first (handles a fresh boot where nothing is loaded yet),
    # then hard-restart the lot.
    pm2 start "$ECOSYSTEM" >/dev/null 2>&1 || true
    pm2 restart "${APPS[@]}"
    pm2 status
    ;;

  reload)
    need_pm2
    echo "==> Reloading OpenCoperLock (zero-downtime where possible)"
    pm2 reload "$ECOSYSTEM"
    pm2 status
    ;;

  status|st)
    need_pm2
    pm2 status
    ;;

  logs|log)
    need_pm2
    if [[ -n "${1:-}" ]]; then
      pm2 logs "$(full_name "$1")"
    else
      pm2 logs opencoperlock-postgres opencoperlock-api opencoperlock-web
    fi
    ;;

  update|upgrade)
    need_pm2
    echo "==> Pulling latest changes"
    git pull --ff-only
    echo "==> Rebuilding and migrating"
    ./scripts/deploy.sh
    echo "==> Reloading processes"
    pm2 reload "$ECOSYSTEM"
    pm2 status
    ;;

  persist|save)
    need_pm2
    pm2 save
    echo "==> To start OpenCoperLock automatically on boot, run the command printed by:"
    echo "      pm2 startup"
    ;;

  *)
    cat >&2 <<USAGE
OpenCoperLock control

Usage: ./scripts/ocl.sh <command> [arg]

  start              Start the whole stack (PostgreSQL, API, web)
  stop               Stop the whole stack
  restart            Restart the whole stack
  reload             Zero-downtime reload (after a redeploy)
  status             Show the PM2 process table
  logs [postgres|api|web]   Tail logs (all by default)
  update             git pull + rebuild/migrate + reload
  persist            Save the process list for reboot survival
USAGE
    exit 1
    ;;
esac
