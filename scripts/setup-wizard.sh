#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OpenCoperLock — interactive setup wizard for a dedicated Linux server.
#
# Walks you through a full bare-metal install:
#   prerequisites (Node/pnpm/PM2) → PostgreSQL → .env (with generated secrets)
#   → build/migrate/seed → PM2 → nginx reverse proxy → Let's Encrypt TLS (certbot).
#
# Designed for Debian/Ubuntu. Run from the repository root:
#   bash scripts/setup-wizard.sh
#
# It asks before doing anything privileged and is safe to re-run.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── pretty output ────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GRN=$'\e[32m'; YLW=$'\e[33m'; BLU=$'\e[34m'; RST=$'\e[0m'
else
  BOLD=''; DIM=''; RED=''; GRN=''; YLW=''; BLU=''; RST=''
fi
say()  { printf '%s\n' "${*}"; }
info() { printf '%s==>%s %s\n' "$BLU$BOLD" "$RST" "$*"; }
ok()   { printf '%s ✓ %s%s\n' "$GRN" "$*" "$RST"; }
warn() { printf '%s ! %s%s\n' "$YLW" "$*" "$RST"; }
die()  { printf '%s ✗ %s%s\n' "$RED$BOLD" "$*" "$RST" >&2; exit 1; }
hr()   { printf '%s────────────────────────────────────────────────────────%s\n' "$DIM" "$RST"; }

# ── prompt helpers ───────────────────────────────────────────────────────────
ask() { # ask "Question" "default" -> echoes answer
  local q="$1" def="${2:-}" ans
  if [[ -n "$def" ]]; then read -r -p "$(printf '%s%s%s [%s]: ' "$BOLD" "$q" "$RST" "$def")" ans || true
  else read -r -p "$(printf '%s%s%s: ' "$BOLD" "$q" "$RST")" ans || true; fi
  printf '%s' "${ans:-$def}"
}
ask_secret() { # ask_secret "Question" -> echoes typed value (hidden)
  local q="$1" ans
  read -r -s -p "$(printf '%s%s%s: ' "$BOLD" "$q" "$RST")" ans || true; printf '\n' >&2
  printf '%s' "$ans"
}
ask_yn() { # ask_yn "Question" "Y|N" -> returns 0 for yes
  local q="$1" def="${2:-Y}" ans
  local hint='[Y/n]'; [[ "$def" =~ ^[Nn]$ ]] && hint='[y/N]'
  read -r -p "$(printf '%s%s%s %s ' "$BOLD" "$q" "$RST" "$hint")" ans || true
  ans="${ans:-$def}"; [[ "$ans" =~ ^[Yy]$ ]]
}

# ── sudo wrapper ─────────────────────────────────────────────────────────────
SUDO=''
need_sudo() {
  if [[ $EUID -ne 0 ]]; then
    command -v sudo >/dev/null 2>&1 || die "This step needs root and 'sudo' is not installed. Re-run as root."
    SUDO='sudo'
  fi
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
[[ -f package.json && -d apps/api ]] || die "Run this from the OpenCoperLock repository root."

# ── 0. distro detection ──────────────────────────────────────────────────────
PKG=''
if command -v apt-get >/dev/null 2>&1; then PKG='apt'; fi
ID_LIKE=''; [[ -f /etc/os-release ]] && ID_LIKE="$(. /etc/os-release; echo "${ID:-} ${ID_LIKE:-}")"

clear || true
printf '%s' "${BOLD}${BLU}"
cat <<'BANNER'
   ___                     ____                          __                  __
  / _ \  _ __   ___  _ __ / ___|___   _ __   ___  _ __  / /  ___    ___ | | __
 | | | || '_ \ / _ \| '_ \| |   / _ \ | '_ \ / _ \| '__|/ /  / _ \  / __|| |/ /
 | |_| || |_) |  __/| | | | |__| (_) || |_) |  __/| |  / /__| (_) || (__ |   <
  \___/ | .__/ \___||_| |_|\____\___/ | .__/ \___||_|  \____/\___/  \___||_|\_\
        |_|                           |_|
BANNER
printf '%s\n' "${RST}"
say "${BOLD}OpenCoperLock setup wizard${RST} — dedicated-server install (PM2 + nginx + TLS)"
hr
[[ "$PKG" == apt ]] || warn "Non-Debian system detected ($ID_LIKE). Package installs are skipped; install prerequisites yourself."

# ── Resume support ───────────────────────────────────────────────────────────
# All later steps are idempotent, so if the wizard crashes part-way (e.g. a package
# install failed) you can simply re-run it and resume with the exact same configuration
# instead of re-answering everything. Answers + generated secrets are saved (0600) to a
# state file after Step 1 and removed on success.
STATE_FILE="$ROOT_DIR/.wizard-state"
RESUME=false
STATE_VARS=(TOPO WEB_DOMAIN API_DOMAIN APP_URL NEXT_PUBLIC_API_URL SETUP_NGINX SETUP_TLS
  WEB_PORT API_PORT ADMIN_EMAIL ADMIN_PASSWORD DB_CHOICE DB_PROVISION DB_NAME DB_USER
  DB_PASS APP_USER DATABASE_URL STORAGE_BASE STORAGE_PATH QUARANTINE_PATH QUOTA_GB CAP_GB
  DEFAULT_USER_QUOTA_BYTES GLOBAL_STORAGE_CAP_BYTES CLAMAV_ENABLED VIRUSTOTAL_API_KEY
  CERTBOT_EMAIL MASTER_KEY SESSION_SECRET)
save_state() {
  umask 077
  : > "$STATE_FILE"
  local v
  for v in "${STATE_VARS[@]}"; do printf '%s=%q\n' "$v" "${!v-}" >> "$STATE_FILE"; done
}
if [[ -f "$STATE_FILE" ]]; then
  if ask_yn 'An unfinished setup was found. Resume with the saved configuration?' 'Y'; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"; RESUME=true
    ok 'Resuming with the saved configuration (every step is idempotent).'
  else
    rm -f "$STATE_FILE"; warn 'Starting fresh; previous saved configuration discarded.'
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. COLLECT ANSWERS  (everything up front; the API URL must be known before build)
# ─────────────────────────────────────────────────────────────────────────────
if ! $RESUME; then
info "Step 1 / 8 — Configuration questions"
say "${DIM}Press Enter to accept the [default].${RST}"
say ""

# Topology
say "How should this be exposed?"
say "  1) Two subdomains       — e.g. copper.forgenet.fr (app) + api.copper.forgenet.fr"
say "  2) Single domain + path — e.g. copper.forgenet.fr (app at /, API at /api)"
say "  3) Local only           — no nginx/TLS, bind to localhost ports (dev / behind own proxy)"
TOPO="$(ask 'Choose 1, 2 or 3' '1')"

WEB_DOMAIN=''; API_DOMAIN=''; APP_URL=''; NEXT_PUBLIC_API_URL=''
SETUP_NGINX=false; SETUP_TLS=false
# Friendly WebDAV mount name: used both for WEBDAV_NAME (.env, the advertised DAV:displayname) and
# for the nginx location path, so the Windows network drive shows as this instead of "dav".
DAV_NAME='OpenCoper'
case "$TOPO" in
  1)
    WEB_DOMAIN="$(ask 'App domain' 'copper.forgenet.fr')"
    API_DOMAIN="$(ask 'API domain' "api.${WEB_DOMAIN}")"
    APP_URL="https://${WEB_DOMAIN}"
    NEXT_PUBLIC_API_URL="https://${API_DOMAIN}"
    SETUP_NGINX=true; SETUP_TLS=true ;;
  2)
    WEB_DOMAIN="$(ask 'Domain' 'copper.forgenet.fr')"
    APP_URL="https://${WEB_DOMAIN}"
    NEXT_PUBLIC_API_URL="https://${WEB_DOMAIN}/api"
    SETUP_NGINX=true; SETUP_TLS=true ;;
  3)
    APP_URL="http://localhost:3000"
    NEXT_PUBLIC_API_URL="http://localhost:4000" ;;
  *) die "Invalid choice: $TOPO" ;;
esac

# Ports
WEB_PORT="$(ask 'Web port (internal)' '3000')"
API_PORT="$(ask 'API port (internal)' '4000')"

# Admin
say ""; info "First administrator account"
ADMIN_EMAIL="$(ask 'Admin email' "${USER:-admin}@${WEB_DOMAIN:-example.com}")"
ADMIN_PASSWORD=''
while [[ -z "$ADMIN_PASSWORD" ]]; do
  ADMIN_PASSWORD="$(ask_secret 'Admin password (min 12 chars)')"
  if [[ ${#ADMIN_PASSWORD} -lt 12 ]]; then warn 'Too short.'; ADMIN_PASSWORD='';
  elif [[ "$ADMIN_PASSWORD" == *'"'* ]]; then warn 'Please avoid the double-quote (") character.'; ADMIN_PASSWORD=''; fi
done

# Database
say ""; info "PostgreSQL"
say "  1) Project-local DB    — runs inside the project on a random free port, supervised"
say "                           by PM2. Best when the usual ports are already taken."
say "  2) System PostgreSQL   — create a database/user on the host's PostgreSQL service."
say "  3) Existing DATABASE_URL — point at a database you already have."
DB_CHOICE="$(ask 'Choose 1, 2 or 3' '1')"
DATABASE_URL=''; DB_PROVISION='local'
DB_NAME='opencoperlock'; DB_USER='opencoperlock'; DB_PASS=''
case "$DB_CHOICE" in
  1)
    DB_PROVISION='local'
    DB_NAME="$(ask 'Database name' 'opencoperlock')"
    DB_USER="$(ask 'Database user' 'opencoperlock')"
    [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid database name (letters, digits, underscore)."
    [[ "$DB_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid database user (letters, digits, underscore)."
    DB_PASS="$(openssl rand -hex 16)"
    # The project-local cluster must be OWNED and RUN by a non-root account (PostgreSQL — and
    # so PM2/deploy.sh while they supervise it — refuse to run as root). When the wizard runs
    # as root we need a separate account; otherwise the cluster belongs to the current user.
    if [[ $EUID -eq 0 ]]; then
      APP_USER="$(ask 'Unprivileged system user to own & run the database' "${SUDO_USER:-opencoperlock}")"
      [[ "$APP_USER" != root ]] || die 'The project-local database cannot be owned by root — pick another user.'
    else
      APP_USER="$(id -un)"
    fi
    # The port (and thus DATABASE_URL) is chosen at provisioning time (Step 3).
    ;;
  2)
    DB_PROVISION='system'
    DB_NAME="$(ask 'Database name' 'opencoperlock')"
    DB_USER="$(ask 'Database user' 'opencoperlock')"
    [[ "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid database name (letters, digits, underscore)."
    [[ "$DB_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "Invalid database user (letters, digits, underscore)."
    DB_PASS="$(openssl rand -hex 16)"
    DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
    ;;
  3)
    DB_PROVISION='existing'
    while [[ -z "$DATABASE_URL" ]]; do DATABASE_URL="$(ask 'Existing DATABASE_URL')"; done
    ;;
  *) die "Invalid choice: $DB_CHOICE" ;;
esac

# Storage
say ""; info "Storage & limits"
DEFAULT_STORAGE="/var/lib/opencoperlock"
STORAGE_BASE="$(ask 'Base directory for encrypted file storage' "$DEFAULT_STORAGE")"
STORAGE_PATH="${STORAGE_BASE%/}/storage"
QUARANTINE_PATH="${STORAGE_BASE%/}/quarantine"
QUOTA_GB="$(ask 'Default per-user quota in GiB (0 = unlimited)' '10')"
CAP_GB="$(ask 'Global storage cap in GiB (0 = unlimited)' '0')"
DEFAULT_USER_QUOTA_BYTES=$(( QUOTA_GB * 1024 * 1024 * 1024 ))
GLOBAL_STORAGE_CAP_BYTES=$(( CAP_GB * 1024 * 1024 * 1024 ))

# Antivirus
say ""; info "Security extras"
CLAMAV_ENABLED=false
if ask_yn 'Enable ClamAV antivirus scanning on upload?' 'N'; then CLAMAV_ENABLED=true; fi
VIRUSTOTAL_API_KEY="$(ask 'VirusTotal API key (optional, blank to skip)' '')"

# TLS email
CERTBOT_EMAIL=''
if $SETUP_TLS; then
  if ask_yn 'Obtain a free Let'\''s Encrypt certificate with certbot?' 'Y'; then
    CERTBOT_EMAIL="$(ask 'Email for Let'\''s Encrypt notices' "$ADMIN_EMAIL")"
  else SETUP_TLS=false; fi
fi

# Secrets
MASTER_KEY="$(openssl rand -base64 32)"
SESSION_SECRET="$(openssl rand -base64 32)"

# Persist everything so a crash in a later step can be resumed without re-asking.
save_state
fi  # end "if ! $RESUME" — questions are skipped when resuming

# ── Summary & confirm ────────────────────────────────────────────────────────
say ""; hr; info "Review"
say "  Topology            : $([[ $TOPO == 1 ]] && echo 'two subdomains' || { [[ $TOPO == 2 ]] && echo 'single domain + /api' || echo 'local only'; })"
[[ -n "$WEB_DOMAIN" ]] && say "  App URL             : ${APP_URL}"
say "  API URL (browser)   : ${NEXT_PUBLIC_API_URL}"
say "  Web / API ports     : ${WEB_PORT} / ${API_PORT}"
say "  Admin email         : ${ADMIN_EMAIL}"
say "  Database            : $(case $DB_PROVISION in local) echo "project-local '${DB_NAME}' (random port, PM2)";; system) echo "system PostgreSQL '${DB_NAME}'";; *) echo 'existing (provided URL)';; esac)"
say "  Storage path        : ${STORAGE_PATH}"
say "  Per-user quota      : ${QUOTA_GB} GiB    Global cap: ${CAP_GB} GiB"
say "  ClamAV / VirusTotal : $([[ $CLAMAV_ENABLED == true ]] && echo on || echo off) / $([[ -n $VIRUSTOTAL_API_KEY ]] && echo set || echo off)"
say "  nginx / TLS         : $([[ $SETUP_NGINX == true ]] && echo yes || echo no) / $([[ $SETUP_TLS == true ]] && echo yes || echo no)"
hr
if ! $RESUME; then
  ask_yn 'Proceed with these settings?' 'Y' || die 'Aborted by user.'
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. PREREQUISITES
# ─────────────────────────────────────────────────────────────────────────────
say ""; info "Step 2 / 8 — Prerequisites"

apt_install() { need_sudo; $SUDO apt-get update -qq; $SUDO apt-get install -y -qq "$@"; }

# Node.js (>=20)
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  if [[ "$PKG" == apt ]] && ask_yn 'Node.js 20+ not found. Install it via NodeSource?' 'Y'; then
    need_sudo
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
    apt_install nodejs
  else warn 'Install Node.js 20+ manually, then re-run.'; fi
fi
command -v node >/dev/null 2>&1 && ok "node $(node -v)"

# pnpm via corepack
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@latest --activate >/dev/null 2>&1 || $SUDO npm i -g pnpm
fi
command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm -v)"

# PM2
if ! command -v pm2 >/dev/null 2>&1; then
  if ask_yn 'PM2 not found. Install globally with npm?' 'Y'; then need_sudo; $SUDO npm i -g pm2; fi
fi
command -v pm2 >/dev/null 2>&1 && ok "pm2 $(pm2 -v 2>/dev/null | head -1)"

# OpenSSL
command -v openssl >/dev/null 2>&1 || { [[ "$PKG" == apt ]] && apt_install openssl; }

# ClamAV
if $CLAMAV_ENABLED && ! command -v clamdscan >/dev/null 2>&1; then
  if [[ "$PKG" == apt ]] && ask_yn 'Install clamav-daemon?' 'Y'; then
    apt_install clamav clamav-daemon
    $SUDO systemctl enable --now clamav-freshclam 2>/dev/null || true
    $SUDO systemctl enable --now clamav-daemon 2>/dev/null || true
    warn 'ClamAV is downloading signatures; first scans may report "unscanned" until ready.'
  fi
fi

# PostgreSQL binaries (needed for system provisioning and for a project-local cluster).
if [[ "$DB_PROVISION" != existing ]] && ! command -v initdb >/dev/null 2>&1 \
   && ! ls /usr/lib/postgresql/*/bin/initdb >/dev/null 2>&1; then
  if [[ "$PKG" == apt ]] && ask_yn 'PostgreSQL is not installed. Install it?' 'Y'; then
    apt_install postgresql postgresql-contrib
    # The project-local cluster does not use the system service; stop it to free port 5432
    # if the operator wants, but leave it as-is by default.
    [[ "$DB_PROVISION" == system ]] && $SUDO systemctl enable --now postgresql || true
  fi
fi

# A project-local cluster needs an unprivileged owner. When running as root, create the
# account if it is missing so Step 3 (and later PM2) can drop privileges to it.
if [[ "$DB_PROVISION" == local && $EUID -eq 0 ]] && ! id -u "$APP_USER" >/dev/null 2>&1; then
  if ask_yn "System user '$APP_USER' does not exist. Create it?" 'Y'; then
    useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER" \
      || die "Could not create system user '$APP_USER'."
    ok "Created system user '$APP_USER'"
  else
    die "Choose an existing unprivileged user for the project-local database, then re-run."
  fi
fi

# nginx + certbot
if $SETUP_NGINX && ! command -v nginx >/dev/null 2>&1 && [[ "$PKG" == apt ]]; then apt_install nginx; fi
if $SETUP_TLS && ! command -v certbot >/dev/null 2>&1 && [[ "$PKG" == apt ]]; then apt_install certbot python3-certbot-nginx; fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. DATABASE PROVISIONING
# ─────────────────────────────────────────────────────────────────────────────
case "$DB_PROVISION" in
  local)
    say ""; info "Step 3 / 8 — Creating a project-local PostgreSQL (random port)"
    # postgres-local.sh must run as the unprivileged app user; it prints the DATABASE_URL.
    # Pre-create .postgres/ owned by that account so a root wizard can hand the cluster off
    # (the script re-execs itself as PG_RUN_USER when invoked as root).
    mkdir -p "$ROOT_DIR/.postgres"
    # Recursive in case a previous (failed) attempt left a root-owned .postgres/ behind.
    [[ $EUID -eq 0 ]] && chown -R "$APP_USER:$(id -gn "$APP_USER")" "$ROOT_DIR/.postgres"
    DATABASE_URL="$(PG_RUN_USER="$APP_USER" DB_NAME="$DB_NAME" DB_USER="$DB_USER" DB_PASS="$DB_PASS" ./scripts/postgres-local.sh init)"
    [[ -n "$DATABASE_URL" ]] || die 'Project-local database provisioning failed.'
    ok "Project-local PostgreSQL ready (${DATABASE_URL##*@})"
    ;;
  system)
    say ""; info "Step 3 / 8 — Creating PostgreSQL database & user on the system service"
    need_sudo
    $SUDO -u postgres psql -v ON_ERROR_STOP=1 <<SQL || die 'Database provisioning failed.'
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE "${DB_USER}" LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE "${DB_USER}" WITH PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SELECT 'CREATE DATABASE "${DB_NAME}" OWNER "${DB_USER}"'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
SQL
    ok "Database '${DB_NAME}' ready"
    ;;
  *)
    say ""; info "Step 3 / 8 — Using existing database (skipped provisioning)"
    ;;
esac
# Capture the (possibly newly chosen) DATABASE_URL so a later crash resumes with it.
save_state

# ─────────────────────────────────────────────────────────────────────────────
# 4. STORAGE DIRECTORIES
# ─────────────────────────────────────────────────────────────────────────────
say ""; info "Step 4 / 8 — Storage directories"
if mkdir -p "$STORAGE_PATH" "$QUARANTINE_PATH" 2>/dev/null; then
  ok "Created $STORAGE_PATH"
else
  need_sudo
  $SUDO mkdir -p "$STORAGE_PATH" "$QUARANTINE_PATH"
  $SUDO chown -R "$(id -u):$(id -g)" "$STORAGE_BASE"
  ok "Created $STORAGE_PATH (chown to $(id -un))"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. WRITE .env
# ─────────────────────────────────────────────────────────────────────────────
say ""; info "Step 5 / 8 — Writing .env"
if [[ -f .env ]]; then
  cp .env ".env.backup.$(date +%s)"; warn 'Existing .env backed up.'
fi
# Write each line with printf %s so values are stored LITERALLY — no shell expansion
# or command substitution. Free-text secrets are double-quoted and escaped so that
# dotenv (Node) preserves them exactly (e.g. a '#' won't be read as an inline comment).
WEB_HOST_VAL=$([[ $SETUP_NGINX == true ]] && echo 127.0.0.1 || echo 0.0.0.0)
emit_secret() { # key value -> KEY="value"
  # dotenv keeps a double-quoted value verbatim (only \n/\r are special) and does NOT
  # decode \" — so we quote without escaping. Values must not contain a literal " (the
  # admin password is validated above; generated keys and the VT key never contain one).
  printf '%s="%s"\n' "$1" "$2"
}
umask 077
{
  printf '# Generated by scripts/setup-wizard.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'NODE_ENV=production\n'
  printf 'APP_URL=%s\n' "$APP_URL"
  printf 'WEB_PORT=%s\n' "$WEB_PORT"
  printf 'API_PORT=%s\n' "$API_PORT"
  printf 'NEXT_PUBLIC_API_URL=%s\n' "$NEXT_PUBLIC_API_URL"
  printf 'WEB_HOST=%s\n' "$WEB_HOST_VAL"
  # Behind nginx: bind the API to localhost and trust one proxy hop so req.ip is the real
  # client (used by rate limiting, session IP tracking and audit logs). Otherwise no trust.
  if [[ $SETUP_NGINX == true ]]; then
    printf 'API_HOST=127.0.0.1\n'
    printf 'TRUST_PROXY=1\n\n'
  else
    printf 'API_HOST=0.0.0.0\n'
    printf 'TRUST_PROXY=false\n\n'
  fi
  printf 'DATABASE_URL=%s\n\n' "$DATABASE_URL"
  emit_secret MASTER_KEY "$MASTER_KEY"
  emit_secret SESSION_SECRET "$SESSION_SECRET"
  printf '\n'
  printf 'ADMIN_EMAIL=%s\n' "$ADMIN_EMAIL"
  emit_secret ADMIN_PASSWORD "$ADMIN_PASSWORD"
  printf '\n'
  printf 'STORAGE_DRIVER=local\n'
  printf 'STORAGE_PATH=%s\n' "$STORAGE_PATH"
  printf 'QUARANTINE_PATH=%s\n' "$QUARANTINE_PATH"
  printf 'DEFAULT_USER_QUOTA_BYTES=%s\n' "$DEFAULT_USER_QUOTA_BYTES"
  printf 'GLOBAL_STORAGE_CAP_BYTES=%s\n' "$GLOBAL_STORAGE_CAP_BYTES"
  printf 'REMOTE_UPLOAD_MAX_BYTES=2147483648\n\n'
  printf 'CLAMAV_ENABLED=%s\n' "$CLAMAV_ENABLED"
  printf 'CLAMAV_HOST=127.0.0.1\n'
  printf 'CLAMAV_PORT=3310\n\n'
  emit_secret VIRUSTOTAL_API_KEY "$VIRUSTOTAL_API_KEY"
  printf '\n'
  # WebDAV mount label (Finder/Cyberduck/GNOME honour it). Matches the friendly nginx path below.
  printf 'WEBDAV_NAME=%s\n' "$DAV_NAME"
} > .env
umask 022
ok ".env written (mode 600). Keep MASTER_KEY safe — losing it loses all server-side files."

# ─────────────────────────────────────────────────────────────────────────────
# 6. BUILD / MIGRATE / SEED
# ─────────────────────────────────────────────────────────────────────────────
say ""; info "Step 6 / 8 — Install, build, migrate, seed (this can take a few minutes)"
bash scripts/deploy.sh

# ─────────────────────────────────────────────────────────────────────────────
# 7. nginx
# ─────────────────────────────────────────────────────────────────────────────
if $SETUP_NGINX; then
  say ""; info "Step 7 / 8 — Configuring nginx"
  need_sudo
  NGINX_CONF="/etc/nginx/sites-available/opencoperlock.conf"
  # $DAV_NAME (set near the top) is exposed as a friendly WebDAV path so the Windows network drive
  # shows as "$DAV_NAME" (Explorer labels the drive from the URL's last segment, not the server's
  # advertised name). The default /dav (or /api/dav) mount keeps working too.
  # Larger client_max_body_size so big uploads aren't rejected by the proxy.
  if [[ "$TOPO" == 1 ]]; then
    $SUDO tee "$NGINX_CONF" >/dev/null <<NGINX
server {
    listen 80;
    server_name ${WEB_DOMAIN};
    client_max_body_size 0;
    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
server {
    listen 80;
    server_name ${API_DOMAIN};
    client_max_body_size 0;
    proxy_request_buffering off;
    # Friendly WebDAV mount: https://${API_DOMAIN}/${DAV_NAME}/ → drive labelled "${DAV_NAME}".
    location /${DAV_NAME}/ {
        proxy_pass http://127.0.0.1:${API_PORT}/dav/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${DAV_NAME};
        proxy_set_header Authorization \$http_authorization;
        proxy_pass_request_headers on;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
    location / {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  else
    $SUDO tee "$NGINX_CONF" >/dev/null <<NGINX
server {
    listen 80;
    server_name ${WEB_DOMAIN};
    client_max_body_size 0;
    # Friendly WebDAV mount: https://${WEB_DOMAIN}/${DAV_NAME}/ → drive labelled "${DAV_NAME}" on
    # Windows. (WebDAV also stays reachable at /api/dav/ via the /api/ block below.)
    location /${DAV_NAME}/ {
        proxy_pass http://127.0.0.1:${API_PORT}/dav/;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /${DAV_NAME};
        proxy_set_header Authorization \$http_authorization;
        proxy_pass_request_headers on;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT}/;
        proxy_request_buffering off;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Prefix /api;
    }
    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  fi
  $SUDO ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/opencoperlock.conf
  $SUDO nginx -t && $SUDO systemctl reload nginx
  ok "nginx configured and reloaded"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 8. TLS (certbot) + PM2
# ─────────────────────────────────────────────────────────────────────────────
if $SETUP_TLS; then
  say ""; info "Step 8 / 8 — TLS certificate (certbot)"
  need_sudo
  DOMS=(-d "$WEB_DOMAIN"); [[ "$TOPO" == 1 ]] && DOMS+=(-d "$API_DOMAIN")
  if $SUDO certbot --nginx --non-interactive --agree-tos -m "$CERTBOT_EMAIL" "${DOMS[@]}" --redirect; then
    ok "HTTPS enabled and auto-renewal scheduled by certbot"
  else
    warn "certbot failed (DNS not pointed yet?). Re-run later:  sudo certbot --nginx ${DOMS[*]}"
  fi
else
  say ""; info "Step 8 / 8 — Starting services"
fi

info "Starting PM2 processes"
pm2 start ecosystem.config.cjs
pm2 save
warn "To restart OpenCoperLock automatically on reboot, run the command pm2 printed above (pm2 startup)."

# Install succeeded — drop the resume state (it holds secrets in cleartext).
rm -f "$STATE_FILE"

# ── Done ─────────────────────────────────────────────────────────────────────
say ""; hr
ok "OpenCoperLock is installed and running."
say ""
say "  ${BOLD}URL${RST}        : ${APP_URL}"
say "  ${BOLD}Admin${RST}      : ${ADMIN_EMAIL}"
say "  ${BOLD}Logs${RST}       : pm2 logs"
say "  ${BOLD}Status${RST}     : pm2 status"
say "  ${BOLD}Redeploy${RST}   : git pull && ./scripts/deploy.sh && pm2 reload ecosystem.config.cjs"
say ""
[[ "$TOPO" == 3 ]] && say "  ${DIM}Local mode: open http://localhost:${WEB_PORT} (set up your own proxy/TLS for production).${RST}"
$SETUP_TLS || { [[ "$TOPO" != 3 ]] && say "  ${YLW}Point your DNS at this server, then run certbot to enable HTTPS.${RST}"; }
hr
