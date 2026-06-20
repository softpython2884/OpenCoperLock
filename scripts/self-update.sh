#!/usr/bin/env bash
#
# In-place self-update, triggered by an admin from the web UI (POST /admin/update spawns this
# detached, so it survives the PM2 reload it performs at the end). It resets the checkout to
# the tracked branch, rebuilds/migrates via deploy.sh, and reloads the PM2 processes.
#
# Progress is written to .update-status.json (read by the API) and full output to .update.log.
#
# NOTE: this discards local changes on the tracked branch with `git reset --hard`. Operators
# who carry local patches should disable the feature with SELF_UPDATE_ENABLED=false.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STATUS="$ROOT/.update-status.json"
LOG="$ROOT/.update.log"
BRANCH="${UPDATE_BRANCH:-main}"
STARTED="$(date -Iseconds)"

# Write a status JSON with only safe, fixed-shape values (no user input → no escaping needed).
write_status() {
  local state="$1" message="$2" finished="$3"
  printf '{"state":"%s","startedAt":"%s","finishedAt":%s,"message":"%s"}\n' \
    "$state" "$STARTED" "$finished" "$message" > "$STATUS"
}

fail() {
  echo "FAILED: $1" >> "$LOG"
  write_status "failed" "$1" "\"$(date -Iseconds)\""
  exit 1
}

: > "$LOG"
echo "== self-update $(date -Iseconds) (branch $BRANCH) ==" >> "$LOG"
write_status "running" "Récupération des sources…" "null"

{ git fetch --all --prune; } >> "$LOG" 2>&1 || fail "git fetch a échoué"
{ git checkout "$BRANCH"; } >> "$LOG" 2>&1 || fail "git checkout $BRANCH a échoué"
{ git reset --hard "origin/$BRANCH"; } >> "$LOG" 2>&1 || fail "git reset a échoué"

write_status "running" "Build et migrations…" "null"
{ ./scripts/deploy.sh; } >> "$LOG" 2>&1 || fail "le build/déploiement a échoué"

# Mark success before reloading: the reload restarts this very API process, which then reads
# the status file. The reload itself is best-effort.
write_status "success" "Mise à jour appliquée, redémarrage…" "\"$(date -Iseconds)\""

if command -v pm2 >/dev/null 2>&1; then
  { pm2 reload "$ROOT/ecosystem.config.cjs"; } >> "$LOG" 2>&1 || echo "pm2 reload warning" >> "$LOG"
else
  echo "pm2 not found on PATH — reload skipped; restart the processes manually." >> "$LOG"
fi

echo "== done $(date -Iseconds) ==" >> "$LOG"
