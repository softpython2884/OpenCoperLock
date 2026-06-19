#!/usr/bin/env bash
#
# Restore an OpenCoperLock backup produced by scripts/backup.sh. DESTRUCTIVE: it overwrites
# the current database contents and the storage directory.
#
#   ./scripts/restore.sh path/to/opencoperlock-YYYYMMDD-HHMMSS.tar.gz
#
# Stop the API first (e.g. `pm2 stop opencoperlock-api`) so nothing writes during restore.
set -euo pipefail

cd "$(dirname "$0")/.."
ARCHIVE="${1:-}"
[[ -f "$ARCHIVE" ]] || { echo "Usage: $0 <backup-archive.tar.gz>" >&2; exit 1; }
[[ -f .env ]] || { echo "ERROR: .env not found." >&2; exit 1; }

read_env() {
  local key="$1" line val
  line="$(grep -E "^${key}=" .env | tail -1 || true)"
  val="${line#*=}"
  [[ "$val" == \"*\" ]] && val="${val:1:${#val}-2}"
  [[ "$val" == \'*\' ]] && val="${val:1:${#val}-2}"
  printf '%s' "$val"
}

DATABASE_URL="$(read_env DATABASE_URL)"
STORAGE_PATH="$(read_env STORAGE_PATH)"
QUARANTINE_PATH="$(read_env QUARANTINE_PATH)"
[[ -n "$DATABASE_URL" ]] || { echo "ERROR: DATABASE_URL not set in .env" >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "ERROR: pg_restore not found (install postgresql-client)." >&2; exit 1; }

echo "This will OVERWRITE the database at \$DATABASE_URL and the storage directory."
read -r -p "Type 'restore' to continue: " confirm
[[ "$confirm" == "restore" ]] || { echo "Aborted."; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar xzf "$ARCHIVE" -C "$WORK"

echo "==> Restoring database"
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" "$WORK/db.dump"

restore_dir() {
  local tarball="$1" target="$2"
  [[ -f "$tarball" && -n "$target" ]] || return 0
  echo "==> Restoring $(basename "$target")"
  # The archive holds directory contents; extract straight into the target path.
  rm -rf "$target"
  mkdir -p "$target"
  tar xzf "$tarball" -C "$target"
}
restore_dir "$WORK/blobs/storage.tar.gz" "$STORAGE_PATH"
restore_dir "$WORK/blobs/quarantine.tar.gz" "$QUARANTINE_PATH"

echo "==> Done. Restart the API (e.g. pm2 start opencoperlock-api)."
echo "    Ensure MASTER_KEY in .env matches the one used when the backup was taken."
