# Deployment

OpenCoperLock is designed to run on a dedicated machine or VM. The supported path is
**Docker Compose**.

## 1. Prerequisites

- Docker Engine + Docker Compose plugin.
- A domain (optional but recommended) and a reverse proxy for TLS (Caddy, nginx, Traefik).

## 2. Configure

```bash
git clone https://github.com/softpython2884/opencoperlock.git
cd opencoperlock
cp .env.example .env
```

Edit `.env` and set, at minimum:

| Variable | Notes |
|----------|-------|
| `POSTGRES_PASSWORD` | strong, unique |
| `MASTER_KEY` | `openssl rand -base64 32` — **back this up; losing it loses all SERVER files** |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first admin, created on first boot |
| `APP_URL` | the public URL of the web app, e.g. `https://copper.forgenet.fr` |
| `NEXT_PUBLIC_API_URL` | the public URL the **browser** uses to reach the API (see below) |

## 3. Run

```bash
docker compose -f infra/docker-compose.yml up --build -d
```

This starts `postgres`, `clamav`, `api` (which runs migrations + seeds the admin), and
`web`. First boot is slower while ClamAV downloads its signature database; uploads still
work in the meantime (they are marked `unscanned` until clamd is ready).

Visit `APP_URL` and sign in with the admin credentials.

## 4. Reverse proxy & the API URL

`NEXT_PUBLIC_API_URL` is **baked into the browser bundle at build time**, so it must be the
URL the browser will actually call. Two common topologies:

**a) Separate subdomains (recommended)**

```
https://copper.forgenet.fr      → web  (:3000)
https://api.copper.forgenet.fr  → api  (:4000)
```

Set `APP_URL=https://copper.forgenet.fr` and
`NEXT_PUBLIC_API_URL=https://api.copper.forgenet.fr`, then rebuild the web image.
The API's CORS is locked to `APP_URL`, and cookies use `SameSite=Lax` + `Secure`.

**b) Single domain via path routing** — proxy `/` to web and a chosen prefix to the API.
You will need to align `NEXT_PUBLIC_API_URL` accordingly and adjust the proxy.

### Example Caddyfile (topology a)

```
copper.forgenet.fr {
    reverse_proxy localhost:3000
}
api.copper.forgenet.fr {
    reverse_proxy localhost:4000
}
```

## 5. Backups

The database (which holds the wrapped per-file keys) and the storage volume (which holds
the ciphertext) are **useless apart** — back them up together. `MASTER_KEY` is the third
piece and must be kept separately and securely; without it, SERVER-mode files cannot be
decrypted even with the database and blobs.

`scripts/backup.sh` bundles both into one timestamped archive (it reads `DATABASE_URL` and
the storage paths from `.env`):

```bash
./scripts/backup.sh /var/backups/opencoperlock      # writes opencoperlock-<timestamp>.tar.gz
```

Automate it with cron (daily 03:30, keep 14 archives):

```cron
30 3 * * *  cd /opt/opencoperlock && BACKUP_RETENTION=14 ./scripts/backup.sh /var/backups/opencoperlock >> /var/log/ocl-backup.log 2>&1
```

To restore (destructive — stop the API first):

```bash
pm2 stop opencoperlock-api
./scripts/restore.sh /var/backups/opencoperlock/opencoperlock-<timestamp>.tar.gz
pm2 start opencoperlock-api
```

The restore re-applies the database dump and unpacks the storage directory. Make sure the
`MASTER_KEY` in `.env` matches the one in use when the backup was taken.

For Docker deployments the same scripts work if `pg_dump`/`pg_restore` are available on the
host and the storage volume is mounted at the path in `.env`; otherwise snapshot the
`pgdata` and `storage` volumes with your usual volume-backup tooling.

## 6. Updating

```bash
git pull
docker compose -f infra/docker-compose.yml up --build -d
```

Migrations are applied automatically on API start (`prisma migrate deploy`). The seed is
idempotent and never overwrites an existing admin.

## Guided install (recommended for a dedicated server)

The interactive wizard does the entire bare-metal install for you on Debian/Ubuntu —
prerequisites, PostgreSQL, `.env` with generated secrets, build, PM2, nginx and TLS:

```bash
bash scripts/setup-wizard.sh
```

It asks for your domain(s), admin account, storage path and limits, then offers to
install Node/pnpm/PM2/PostgreSQL/nginx/certbot as needed. Secrets (`MASTER_KEY`,
`SESSION_SECRET`, DB password) are generated for you and written to a `0600` `.env`.
Re-run it any time; it backs up an existing `.env` first. The sections below document
the same steps manually.

## Bare-metal with PM2 (dedicated server)

For a dedicated Linux box you can run the two Node processes under
[PM2](https://pm2.keymetrics.io/) instead of Docker. You provide Postgres (and,
optionally, ClamAV) yourself.

### 1. Prerequisites

```bash
# Node 20+ and pnpm
corepack enable
# PM2
npm i -g pm2
# PostgreSQL running locally, plus a database + user for OpenCoperLock.
# (optional) clamav-daemon if you want antivirus scanning.
```

### Database options

The wizard offers three ways to get a database, picked during setup:

1. **Project-local PostgreSQL (recommended on busy hosts).** A dedicated cluster is created
   inside the repo under `.postgres/`, listening on `127.0.0.1` on a **random free port**
   chosen at install time, and supervised by **PM2** alongside the app. Nothing needs port
   5432 (or any fixed port) to be free. Managed with `scripts/postgres-local.sh`.
2. **System PostgreSQL.** A database + user are created on the host's PostgreSQL service.
3. **Existing `DATABASE_URL`.** Point at a database you already run.

For the manual path, the project-local cluster can be created directly:

```bash
DB_NAME=opencoperlock DB_USER=opencoperlock ./scripts/postgres-local.sh init   # prints DATABASE_URL
# put that DATABASE_URL in .env, then ./scripts/deploy.sh && pm2 start ecosystem.config.cjs
```

### 2. Configure

```bash
git clone https://github.com/softpython2884/opencoperlock.git
cd opencoperlock
cp .env.example .env
```

Edit `.env`:

- `DATABASE_URL` — your database (for a project-local cluster this is generated for you,
  with the random port baked in).
- `MASTER_KEY`, `SESSION_SECRET` — `openssl rand -base64 32` each.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- `APP_URL` — your public site URL, e.g. `https://copper.forgenet.fr`.
- `NEXT_PUBLIC_API_URL` — the public URL the **browser** uses to reach the API
  (baked into the build), e.g. `https://api.copper.forgenet.fr`.
- `STORAGE_PATH` / `QUARANTINE_PATH` — absolute, writable paths (see `.env.example`).
- `CLAMAV_ENABLED` — `false` if you're not running clamd.

### 3. Build, migrate, seed

```bash
./scripts/deploy.sh
```

This installs deps, builds `shared` + `api` + the web standalone bundle, applies Prisma
migrations, seeds the first admin, and creates the storage directories.

### 4. Start under PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save          # remember the process list
pm2 startup       # generate & install the systemd unit so PM2 restarts on boot
```

This launches `opencoperlock-api` (Fastify + the Remote-Upload worker, single instance)
and `opencoperlock-web` (the Next.js standalone server). Useful commands:

```bash
pm2 status
pm2 logs opencoperlock-api
pm2 reload ecosystem.config.cjs   # zero-downtime reload after a redeploy
```

> The API loads the repo-root `.env` itself, so no secrets are stored in the PM2 config.
> Keep `opencoperlock-api` at a single instance — the Remote-Upload worker must not run in
> parallel copies.

### 5. Redeploying

```bash
git pull
./scripts/deploy.sh
pm2 reload ecosystem.config.cjs
```

### 6. Reverse proxy

Put both processes behind your proxy exactly as in the Docker section above (web on
:3000, API on :4000), terminating TLS there. Set `WEB_HOST=127.0.0.1` in the environment
if you want the web process to bind only to localhost behind the proxy.

## Running without Docker (dev)

```bash
pnpm install
# bring up Postgres (and optionally clamd), then:
export DATABASE_URL=postgresql://user:pass@localhost:5432/opencoperlock
pnpm --filter @opencoperlock/api prisma:migrate
pnpm --filter @opencoperlock/api db:seed
pnpm dev   # runs web + api together
```
