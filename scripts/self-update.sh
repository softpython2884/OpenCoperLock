#!/usr/bin/env bash
#
# In-place self-update, triggered by an admin from the web UI (POST /admin/update spawns this
# detached, so it survives the PM2 reload it performs at the end). It resets the checkout to
# the tracked branch, rebuilds/migrates via deploy.sh, and reloads the PM2 processes.
#
# SAFETY (hardened): the current commit is snapshotted *before* anything changes. If the build
# fails, OR the API does not answer /health after the reload, the checkout is rolled back to that
# snapshot, rebuilt and reloaded — so a bad update can no longer leave the instance down.
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

# Read a single value from .env WITHOUT sourcing it (mirrors deploy.sh).
read_env() {
  local key="$1" line val
  [[ -f .env ]] || { printf ''; return; }
  line="$(grep -E "^${key}=" .env | tail -1 || true)"
  val="${line#*=}"
  [[ "$val" == \"*\" ]] && val="${val:1:${#val}-2}"
  [[ "$val" == \'*\' ]] && val="${val:1:${#val}-2}"
  printf '%s' "$val"
}

API_PORT="$(read_env API_PORT)"; : "${API_PORT:=4000}"
HEALTH_URL="http://127.0.0.1:${API_PORT}/health"

reload_pm2() {
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2 not found on PATH — reload skipped; restart the processes manually." >> "$LOG"
    return
  fi
  # Reload ONLY our application processes, by name — never a project-local Postgres, which must
  # not be restarted by an app update. `reload` is graceful; fall back to `restart` if it can't
  # be reloaded. Each process is best-effort so one missing name doesn't abort the update.
  local app
  for app in opencoperlock-api opencoperlock-web; do
    if pm2 describe "$app" >/dev/null 2>&1; then
      echo "reloading $app" >> "$LOG"
      { pm2 reload "$app" --update-env || pm2 restart "$app" --update-env; } >> "$LOG" 2>&1 \
        || echo "warn: could not reload $app" >> "$LOG"
    else
      echo "note: pm2 process '$app' not found — skipped" >> "$LOG"
    fi
  done
}

# True once the API answers its /health endpoint. Tries curl, then wget, then a raw TCP probe.
http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 4 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -T 4 -O /dev/null "$HEALTH_URL" >/dev/null 2>&1 && return 0
    return 1
  fi
  # Last resort: just check the port accepts a connection.
  (exec 3<>"/dev/tcp/127.0.0.1/${API_PORT}") 2>/dev/null && return 0
  return 1
}

# Poll /health for up to ~60s (30 × 2s). PM2 reload is graceful, so give the new process time.
wait_healthy() {
  local i
  for i in $(seq 1 30); do
    if http_ok; then return 0; fi
    sleep 2
  done
  return 1
}

# Roll the checkout back to the pre-update commit and bring it back up. Best-effort.
rollback() {
  local reason="$1"
  echo "ROLLBACK ($reason) → $PREV_SHA" >> "$LOG"
  write_status "running" "Échec — restauration de la version précédente…" "null"
  { git reset --hard "$PREV_SHA"; } >> "$LOG" 2>&1
  { ./scripts/deploy.sh; } >> "$LOG" 2>&1 || echo "rollback rebuild warning" >> "$LOG"
  reload_pm2
  write_status "failed" "Mise à jour annulée et version précédente restaurée ($reason)." "\"$(date -Iseconds)\""
  echo "== rolled back $(date -Iseconds) ==" >> "$LOG"
  exit 1
}

: > "$LOG"
echo "== self-update $(date -Iseconds) (branch $BRANCH) ==" >> "$LOG"
write_status "running" "Récupération des sources…" "null"

# Snapshot the current commit so we can return to it if anything goes wrong.
PREV_SHA="$(git rev-parse HEAD 2>/dev/null || echo '')"
[[ -n "$PREV_SHA" ]] || { write_status "failed" "Impossible de lire le commit courant (pas un dépôt git ?)." "\"$(date -Iseconds)\""; exit 1; }
echo "snapshot PREV_SHA=$PREV_SHA" >> "$LOG"

{ git fetch --all --prune; } >> "$LOG" 2>&1 || { write_status "failed" "git fetch a échoué." "\"$(date -Iseconds)\""; exit 1; }
{ git checkout "$BRANCH"; } >> "$LOG" 2>&1 || { write_status "failed" "git checkout $BRANCH a échoué." "\"$(date -Iseconds)\""; exit 1; }
{ git reset --hard "origin/$BRANCH"; } >> "$LOG" 2>&1 || rollback "git reset a échoué"

write_status "running" "Build et migrations…" "null"
{ ./scripts/deploy.sh; } >> "$LOG" 2>&1 || rollback "le build/déploiement a échoué"

# Reload, then verify the API actually comes back before declaring success.
write_status "running" "Redémarrage et vérification de l'état…" "null"
reload_pm2
if ! wait_healthy; then
  rollback "l'API ne répond plus après le redémarrage"
fi

write_status "success" "Mise à jour appliquée et vérifiée." "\"$(date -Iseconds)\""
echo "== done $(date -Iseconds) ==" >> "$LOG"
