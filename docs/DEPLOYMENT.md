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

## Running without Docker (dev)

```bash
pnpm install
# bring up Postgres (and optionally clamd), then:
export DATABASE_URL=postgresql://user:pass@localhost:5432/opencoperlock
pnpm --filter @opencoperlock/api prisma:migrate
pnpm --filter @opencoperlock/api db:seed
pnpm dev   # runs web + api together
```
