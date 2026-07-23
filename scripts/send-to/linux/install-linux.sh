#!/usr/bin/env bash
# OpenCoperLock — install "Send to OpenCoperLock" in your Linux file manager.
#
# Per-user, no root. Installs a right-click entry for GNOME Files (Nautilus), Cinnamon (Nemo) and
# KDE Dolphin. Selected files upload to the "ComputerShared" space of your Drive over WebDAV.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
assets="$(cd "$here/../assets" && pwd)"
data="${XDG_DATA_HOME:-$HOME/.local/share}/opencoperlock"
cfgdir="${XDG_CONFIG_HOME:-$HOME/.config}/opencoperlock"
mkdir -p "$data" "$cfgdir"

default_base="https://copper.forgenet.fr/api/dav"
read -rp "WebDAV base URL [$default_base]: " BASE
BASE="${BASE:-$default_base}"
BASE="${BASE%/}"
read -rsp "Paste your OpenCoperLock API token (ocl_...): " TOKEN
echo
[ -n "$TOKEN" ] || { echo "No token provided."; exit 1; }

# Store config readable only by you.
umask 077
printf 'BASE=%q\nTOKEN=%q\n' "$BASE" "$TOKEN" > "$cfgdir/config"
chmod 600 "$cfgdir/config"

# Install the uploader + icon.
install -m 0755 "$here/send.sh" "$data/send.sh"
install -m 0644 "$assets/opencoperlock.png" "$data/opencoperlock.png"

installed=()

# GNOME Files (Nautilus) & Cinnamon (Nemo): scripts appear under right-click > Scripts.
for pair in "nautilus:GNOME Files" "nemo:Cinnamon"; do
  fm="${pair%%:*}"; label="${pair##*:}"
  sd="$HOME/.local/share/$fm/scripts"
  if [ -d "$HOME/.local/share/$fm" ] || command -v "$fm" >/dev/null 2>&1; then
    mkdir -p "$sd"
    ln -sf "$data/send.sh" "$sd/Send to OpenCoperLock"
    installed+=("$label (Scripts ▸ Send to OpenCoperLock)")
  fi
done

# KDE Dolphin service menu (shows the icon in the context menu directly).
for sm in "$HOME/.local/share/kio/servicemenus" "$HOME/.local/share/kservices5/ServiceMenus"; do
  mkdir -p "$sm"
  cat > "$sm/opencoperlock.desktop" <<EOF
[Desktop Entry]
Type=Service
MimeType=all/all;
Actions=sendToOpenCoperLock;
X-KDE-Priority=TopLevel

[Desktop Action sendToOpenCoperLock]
Name=Send to OpenCoperLock
Icon=$data/opencoperlock.png
Exec=$data/send.sh %F
EOF
  chmod +x "$sm/opencoperlock.desktop" 2>/dev/null || true
done
installed+=("KDE Dolphin (right-click ▸ Send to OpenCoperLock)")

# Pre-create the space.
curl -fsS -u "me:$TOKEN" -X MKCOL "$BASE/ComputerShared/" >/dev/null 2>&1 || true

echo
echo "Installed for:"
for i in "${installed[@]}"; do echo "  • $i"; done
echo
echo "Uploads land in the 'ComputerShared' space of your Drive."
echo "If the entry doesn't appear yet, restart the file manager:"
echo "  nautilus -q   |   nemo -q   |   (KDE: log out/in or 'kbuildsycoca5')"
