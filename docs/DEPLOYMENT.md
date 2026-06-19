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

Back up **together** (they are useless apart):

- the Postgres database (`pgdata` volume), and
- the encrypted storage volume (`storage`).

Also store `MASTER_KEY` somewhere safe and separate. Without it, SERVER-mode files cannot
be decrypted even with the database and blobs.

## 6. Updating

```bash
git pull
docker compose -f infra/docker-compose.yml up --build -d
```

Migrations are applied automatically on API start (`prisma migrate deploy`). The seed is
idempotent and never overwrites an existing admin.

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

### 2. Configure

```bash
git clone https://github.com/softpython2884/opencoperlock.git
cd opencoperlock
cp .env.example .env
```

Edit `.env`:

- `DATABASE_URL` — point at your local Postgres.
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
