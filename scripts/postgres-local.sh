#!/usr/bin/env bash
#
# Manage a PROJECT-LOCAL PostgreSQL cluster, living entirely inside the repo under
# `.postgres/`, listening on 127.0.0.1 on a RANDOM free port chosen at init time. This is
# for hosts where the usual ports are already taken and you don't want a system-wide DB.
#
#   ./scripts/postgres-local.sh init      # create the cluster + role + database (prints DATABASE_URL)
#   ./scripts/postgres-local.sh start     # run postgres in the foreground (used by PM2)
#   ./scripts/postgres-local.sh ctl-start # start in the background via pg_ctl (used by deploy.sh)
#   ./scripts/postgres-local.sh ctl-stop  # stop a pg_ctl-started instance
#   ./scripts/postgres-local.sh status
#
# Credentials for `init` come from env: DB_NAME, DB_USER, DB_PASS (DB_PASS is generated if
# unset). The port is persisted in `.postgres/port` and reused by every later command.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# PostgreSQL refuses to run as root, and the cluster should be owned by the app's run user.
if [[ $EUID -eq 0 ]]; then
  echo "ERROR: run this as the unprivileged user that will own the database, not root." >&2
  echo "       (The PM2 app user owns .postgres/; PostgreSQL will not start as root.)" >&2
  exit 1
fi
PGROOT="$ROOT/.postgres"
DATA="$PGROOT/data"
SOCK="$PGROOT/socket"
PORT_FILE="$PGROOT/port"
LOG="$PGROOT/postgres.log"

# Locate the PostgreSQL server binaries. They are on PATH on most systems; on Debian/Ubuntu
# they live under /usr/lib/postgresql/<version>/bin.
find_pg_bin() {
  if command -v initdb >/dev/null 2>&1; then echo ""; return; fi
  local d
  d="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [[ -n "$d" && -x "$d/initdb" ]] || {
    echo "ERROR: PostgreSQL server binaries (initdb) not found. Install the 'postgresql' package." >&2
    exit 1
  }
  echo "$d/"
}
PGBIN="$(find_pg_bin)"

# Pick a free TCP port on 127.0.0.1 in a high range, avoiding anything already listening.
pick_free_port() {
  local p
  for _ in $(seq 1 100); do
    p=$(( (RANDOM << 2 ^ RANDOM) % 25000 + 30000 )) # 30000..54999, well-spread
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
      echo "$p"; return 0
    fi
    exec 3>&- 2>/dev/null || true
  done
  echo "ERROR: could not find a free port after 100 tries." >&2
  exit 1
}

read_port() {
  [[ -f "$PORT_FILE" ]] || { echo "ERROR: $PORT_FILE missing — run 'init' first." >&2; exit 1; }
  cat "$PORT_FILE"
}

cmd_init() {
  local DB_NAME="${DB_NAME:-opencoperlock}"
  local DB_USER="${DB_USER:-opencoperlock}"
  local DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"

  mkdir -p "$PGROOT" "$SOCK"
  chmod 700 "$PGROOT"

  if [[ ! -f "$DATA/PG_VERSION" ]]; then
    echo "==> Initialising cluster in $DATA" >&2
    # Superuser 'postgres'; local socket = trust, TCP = scram (the app uses a password).
    "${PGBIN}initdb" -D "$DATA" -U postgres -E UTF8 --auth-local=trust --auth-host=scram-sha-256 >/dev/null
  fi

  local PORT
  if [[ -f "$PORT_FILE" ]]; then PORT="$(cat "$PORT_FILE")"; else PORT="$(pick_free_port)"; echo "$PORT" > "$PORT_FILE"; fi
  echo "==> Using port $PORT" >&2

  # Start temporarily to provision the role + database, then stop.
  "${PGBIN}pg_ctl" -D "$DATA" -w -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" -l "$LOG" start >/dev/null
  trap '"${PGBIN}pg_ctl" -D "$DATA" -w stop >/dev/null 2>&1 || true' EXIT

  "${PGBIN}psql" -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
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

  "${PGBIN}pg_ctl" -D "$DATA" -w stop >/dev/null
  trap - EXIT
  echo "==> Project-local PostgreSQL ready on 127.0.0.1:$PORT" >&2
  # Emit the connection string on stdout so callers (the wizard) can capture it.
  echo "postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:${PORT}/${DB_NAME}"
}

cmd_start() {
  local PORT; PORT="$(read_port)"
  mkdir -p "$SOCK"
  # Foreground — PM2 supervises this process.
  exec "${PGBIN}postgres" -D "$DATA" -p "$PORT" -k "$SOCK" -c listen_addresses=127.0.0.1
}

cmd_ctl_start() {
  local PORT; PORT="$(read_port)"
  mkdir -p "$SOCK"
  "${PGBIN}pg_ctl" -D "$DATA" -w -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" -l "$LOG" start
}

cmd_ctl_stop() {
  "${PGBIN}pg_ctl" -D "$DATA" -w stop
}

cmd_status() {
  "${PGBIN}pg_ctl" -D "$DATA" status || true
}

case "${1:-}" in
  init) cmd_init ;;
  start) cmd_start ;;
  ctl-start) cmd_ctl_start ;;
  ctl-stop) cmd_ctl_stop ;;
  status) cmd_status ;;
  *) echo "Usage: $0 {init|start|ctl-start|ctl-stop|status}" >&2; exit 1 ;;
esac
