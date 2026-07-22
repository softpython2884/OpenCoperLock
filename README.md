# OpenCoperLock

A self-hostable private cloud for a single dedicated machine. It combines an ordinary
file Drive with three things most "drop a file" tools lack: a code-gated Quick-Upload for
any device, a server-side Remote-Upload from a link, and a hybrid encryption model that
lets you choose, per folder, between server-side encryption at rest (scannable) and a true
client-side zero-knowledge vault.

Licensed under the GNU AGPLv3. If you host a modified version, your users are entitled to
the source.

## 📚 Documentation

- **Full documentation (website)** — a complete, public guide lives at **`/docs`** on any
  instance (no login). It covers every feature with “what it is / what you can do / how”:
  spaces & vaults, files & versions, sharing, Quick-Upload, Remote-Upload, the REST API,
  webhooks, WebDAV, security, account & admin, mobile/PWA, and the keyboard shortcuts.
- **[REST API & integrations](docs/API.md)** — personal API tokens, the `/api/v1` endpoints,
  outgoing webhooks, and mounting the Drive over **WebDAV** (with `curl`/`rclone` examples).
- **[Deployment](docs/DEPLOYMENT.md)** — bare-metal (PM2) and Docker, behind nginx.
- **[Contributing](CONTRIBUTING.md)** · **[Security policy](SECURITY.md)**

## What it does

- **Drive** — browse, upload (streaming), download and delete files and folders, with a
  per-user storage quota and a deployment-wide cap.
- **Shared Spaces** — collaborative areas owned by one user and shared with a group as
  *editor* (read/write) or *viewer* (read-only). The owner pays for the storage; deleting a
  space either wipes it or transfers it (and its storage cost) to the longest-standing member.
  Server-side encrypted only — no zero-knowledge, which can't be shared.
- **Quick-Upload** — open a temporary drop zone on any device by entering an active code,
  no full login required. Optional password, expiry and usage limit per code.
- **Remote-Upload** — paste a link and the server fetches the file directly, so a phone on
  a metered connection never has to relay the bytes. SSRF-guarded.
- **Antivirus** — files are scanned with ClamAV on upload; an optional VirusTotal hash
  lookup is available on demand. Infected files are quarantined.
- **Hybrid encryption** — AES-256-GCM at rest by default (so files can be scanned), plus an
  opt-in zero-knowledge vault whose contents are encrypted in the browser and never
  readable by the server.
- **Public / Open spaces** — a space whose files are stored unencrypted and served at a
  direct, stable URL (`/p/<code>`) with range requests and long caching — for hosting public
  images/videos to embed on other sites, loading as fast as possible.
- **Administration** — create users, set per-user quotas, define the global cap, manage
  Quick-Upload codes and read the audit log. One-click (or **automatic**) self-update from
  GitHub, with a "What's new" dialog that shows each user the release notes once per update.

## Architecture

A TypeScript monorepo managed with pnpm workspaces:

```
apps/web        Next.js (App Router) front end
apps/api        Fastify API + the Remote-Upload worker
packages/shared zod schemas, shared types, server crypto, the SSRF guard, quota math
infra           Dockerfiles, docker-compose, ClamAV config
docs            architecture, security, threat model, deployment
```

The API uses Prisma and PostgreSQL. Background work runs on a database-backed worker loop
inside the API process, which keeps a deployment to a single moving part; Redis/BullMQ is a
documented upgrade for horizontal scale. Storage goes through a small driver interface; a
local-filesystem driver ships, and an S3-compatible one can be added without touching the
routes. See `docs/ARCHITECTURE.md` for the full design.

## Installation

### Guided (dedicated Debian/Ubuntu server)

The wizard installs prerequisites and configures PostgreSQL, the environment, the build,
PM2, an nginx reverse proxy and a Let's Encrypt certificate:

```bash
git clone https://github.com/softpython2884/opencoperlock.git
cd opencoperlock
bash scripts/setup-wizard.sh
```

### Manual (PM2)

Provide your own PostgreSQL, then:

```bash
cp .env.example .env        # set secrets and paths
./scripts/deploy.sh         # install, build, migrate, seed
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

### Docker

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build -d
```

Generate strong secrets with `openssl rand -base64 32`. Full production notes, including
reverse-proxy topology and backups, are in `docs/DEPLOYMENT.md`.

## Development

```bash
pnpm install
pnpm --filter @opencoperlock/shared build
pnpm --filter @opencoperlock/api prisma:generate
pnpm dev
```

The API needs a local PostgreSQL. ClamAV is optional in development; when it is
unreachable, uploads are accepted and marked unscanned. Project gates: `pnpm typecheck`,
`pnpm lint`, `pnpm test`.

## Security

The encryption model, trust boundaries and a candid threat model are documented in
`docs/SECURITY.md` and `docs/THREAT_MODEL.md`. To report a vulnerability, see `SECURITY.md`.

## Contributing

See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## License

GNU AGPL v3.0 or later. See `LICENSE`.
