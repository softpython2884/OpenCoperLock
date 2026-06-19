#!/usr/bin/env bash
#
# Back up OpenCoperLock: the PostgreSQL database AND the encrypted storage volume, into a
# single timestamped archive. These two must be kept together — the database holds the
# wrapped per-file keys, the storage holds the ciphertext, and neither is useful alone.
#
#   ./scripts/backup.sh [output-dir]      # default: ./backups
#
# IMPORTANT: this does NOT back up MASTER_KEY (it lives only in .env). Store MASTER_KEY
# separately and securely — without it, SERVER-mode files cannot be decrypted.
#
# Suggested cron (daily at 03:30, keep 14 days):
#   30 3 * * *  cd /opt/opencoperlock && BACKUP_RETENTION=14 ./scripts/backup.sh >> /var/log/ocl-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "ERROR: .env not found." >&2; exit 1; }

# Read a value from .env without sourcing it (safe with special characters).
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
command -v pg_dump >/dev/null || { echo "ERROR: pg_dump not found (install postgresql-client)." >&2; exit 1; }

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> Dumping database"
pg_dump --no-owner --format=custom "$DATABASE_URL" > "$WORK/db.dump"

echo "==> Archiving storage"
mkdir -p "$WORK/blobs"
# Archive directory *contents* (top-level "./") so restore is independent of the path name.
if [[ -n "$STORAGE_PATH" && -d "$STORAGE_PATH" ]]; then
  tar czf "$WORK/blobs/storage.tar.gz" -C "$STORAGE_PATH" .
fi
if [[ -n "$QUARANTINE_PATH" && -d "$QUARANTINE_PATH" ]]; then
  tar czf "$WORK/blobs/quarantine.tar.gz" -C "$QUARANTINE_PATH" .
fi

ARCHIVE="$OUT_DIR/opencoperlock-$STAMP.tar.gz"
echo "==> Bundling -> $ARCHIVE"
tar czf "$ARCHIVE" -C "$WORK" .
chmod 600 "$ARCHIVE"

# Retention: keep the newest $BACKUP_RETENTION archives if set.
if [[ -n "${BACKUP_RETENTION:-}" ]]; then
  ls -1t "$OUT_DIR"/opencoperlock-*.tar.gz 2>/dev/null | tail -n +$((BACKUP_RETENTION + 1)) | xargs -r rm -f
fi

echo "==> Done: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
echo "    Remember: MASTER_KEY is NOT in this archive. Back it up separately."
