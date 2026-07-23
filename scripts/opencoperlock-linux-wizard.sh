#!/usr/bin/env bash
# OpenCoperLock - Linux setup wizard.
#
# One command to set up the OpenCoperLock client tools on a Linux machine:
#   curl -fsSL https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/opencoperlock-linux-wizard.sh | bash
#
# It asks for your WebDAV URL + API token once, then lets you choose to install the right-click
# "Send to OpenCoperLock" integration and/or mount your Drive as a folder (via rclone). Everything
# is per-user; no root needed (rclone/davfs install may need your package manager).
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/send-to"
data="${XDG_DATA_HOME:-$HOME/.local/share}/opencoperlock"
cfgdir="${XDG_CONFIG_HOME:-$HOME/.config}/opencoperlock"
mkdir -p "$data" "$cfgdir"

say()  { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }

# When piped through `curl | bash`, stdin is the script, so read prompts from the terminal.
if [ -r /dev/tty ]; then exec 3</dev/tty; else exec 3<&0; fi
ask()  { local p="$1" d="${2:-}" a; printf '%s' "$p" >&2; IFS= read -r a <&3 || true; printf '%s' "${a:-$d}"; }
asks() { local p="$1" a; printf '%s' "$p" >&2; IFS= read -rs a <&3 || true; printf '\n' >&2; printf '%s' "$a"; }

say "=== OpenCoperLock - Linux setup wizard ==="
echo

default_base="https://copper.forgenet.fr/api/dav"
BASE="$(ask "WebDAV base URL [$default_base]: " "$default_base")"
BASE="${BASE%/}"
TOKEN="$(asks "Paste your OpenCoperLock API token (ocl_...): ")"
[ -n "$TOKEN" ] || { warn "No token provided - aborting."; exit 1; }

# Save config (readable only by you).
umask 077
printf 'BASE=%q\nTOKEN=%q\n' "$BASE" "$TOKEN" > "$cfgdir/config"
chmod 600 "$cfgdir/config"
ok "Saved config to $cfgdir/config"

# Pre-create the ComputerShared space.
curl -fsS -u "me:$TOKEN" -X MKCOL "$BASE/ComputerShared/" >/dev/null 2>&1 || true

echo
say "What do you want to set up?"
echo "  1) Right-click 'Send to OpenCoperLock' (file-manager integration)"
echo "  2) Mount your Drive as a folder (via rclone)"
echo "  3) Both"
echo "  4) Nothing else (config only)"
choice="$(ask "Choice [3]: " "3")"

install_sendto() {
  say "Installing the 'Send to' integration..."
  # Fetch the uploader + icon from the official repo.
  curl -fsSL "$REPO_RAW/linux/send.sh" -o "$data/send.sh" && chmod 0755 "$data/send.sh"
  curl -fsSL "$REPO_RAW/assets/opencoperlock.png" -o "$data/opencoperlock.png" || true

  local done=()
  for fm in nautilus nemo; do
    if [ -d "$HOME/.local/share/$fm" ] || command -v "$fm" >/dev/null 2>&1; then
      mkdir -p "$HOME/.local/share/$fm/scripts"
      ln -sf "$data/send.sh" "$HOME/.local/share/$fm/scripts/Send to OpenCoperLock"
      done+=("$fm")
    fi
  done
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
  ok "Send-to installed for: ${done[*]:-KDE} (right-click a file; you may need: nautilus -q / nemo -q)"
}

mount_rclone() {
  if ! command -v rclone >/dev/null 2>&1; then
    warn "rclone is not installed. Install it, then re-run this wizard and choose option 2."
    warn "  Debian/Ubuntu: sudo apt install rclone   |   Fedora: sudo dnf install rclone   |   or: curl https://rclone.org/install.sh | sudo bash"
    return
  fi
  say "Configuring an rclone remote 'opencoperlock'..."
  rclone config delete opencoperlock >/dev/null 2>&1 || true
  rclone config create opencoperlock webdav url "$BASE" vendor other user me pass "$TOKEN" >/dev/null
  local mnt="$HOME/OpenCoperLock"
  mkdir -p "$mnt"
  ok "Remote ready. Test it:  rclone lsd opencoperlock:"
  echo
  local now
  now="$(ask "Mount it now at $mnt ? [y/N]: " "N")"
  if [ "${now,,}" = "y" ] || [ "${now,,}" = "o" ]; then
    rclone mount opencoperlock: "$mnt" --vfs-cache-mode writes --daemon
    ok "Mounted at $mnt (background). Unmount with: fusermount -u \"$mnt\""
  else
    echo "Mount later with:"
    echo "  rclone mount opencoperlock: \"$mnt\" --vfs-cache-mode writes --daemon"
  fi
}

case "$choice" in
  1) install_sendto ;;
  2) mount_rclone ;;
  4) : ;;
  *) install_sendto; echo; mount_rclone ;;
esac

echo
ok "Done. Your uploads land in the 'ComputerShared' space of your Drive."
