#!/usr/bin/env bash
# OpenCoperLock — "Send to" uploader (Linux).
#
# Called by the file-manager menu entry (Nautilus/Nemo script or KDE service menu) with the
# selected files. Uploads each to the "ComputerShared" space (a top-level folder in your Drive)
# over WebDAV, then shows a desktop notification. Config lives in
# ~/.config/opencoperlock/config (chmod 600), written by install-linux.sh.
set -euo pipefail

cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencoperlock/config"
icon="${XDG_DATA_HOME:-$HOME/.local/share}/opencoperlock/opencoperlock.png"

notify() { command -v notify-send >/dev/null 2>&1 && notify-send -i "$icon" "OpenCoperLock" "$1" || echo "OpenCoperLock: $1"; }

[ -f "$cfg" ] || { notify "Not configured — run install-linux.sh"; exit 1; }
# shellcheck source=/dev/null
. "$cfg"                       # provides BASE and TOKEN
BASE="${BASE%/}"

# Collect selected files: Nautilus / Nemo pass them via env vars (newline-separated); KDE and the
# CLI pass them as arguments.
files=()
if [ -n "${NAUTILUS_SCRIPT_SELECTED_FILE_PATHS:-}" ]; then
  while IFS= read -r p; do [ -n "$p" ] && files+=("$p"); done <<< "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS"
elif [ -n "${NEMO_SCRIPT_SELECTED_FILE_PATHS:-}" ]; then
  while IFS= read -r p; do [ -n "$p" ] && files+=("$p"); done <<< "$NEMO_SCRIPT_SELECTED_FILE_PATHS"
else
  files=("$@")
fi
[ "${#files[@]}" -gt 0 ] || { notify "No files to send."; exit 0; }

urlencode() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$1"
  else
    local LC_ALL=C s="$1" o='' i c hex
    for ((i = 0; i < ${#s}; i++)); do
      c="${s:i:1}"
      case "$c" in
        [a-zA-Z0-9._~-]) o+="$c" ;;
        *) printf -v hex '%%%02X' "'$c"; o+="$hex" ;;
      esac
    done
    printf '%s' "$o"
  fi
}

# Ensure the space exists (a 405 "already there" is fine).
curl -fsS -u "me:$TOKEN" -X MKCOL "$BASE/ComputerShared/" >/dev/null 2>&1 || true

ok=0; fail=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue     # skip folders / non-files
  name="$(urlencode "$(basename -- "$f")")"
  if curl -fsS -u "me:$TOKEN" -T "$f" "$BASE/ComputerShared/$name" >/dev/null 2>&1; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
  fi
done

if [ "$fail" -eq 0 ]; then notify "Sent $ok file(s) to ComputerShared."
else notify "Sent $ok, $fail failed — check your token or connection."; fi
