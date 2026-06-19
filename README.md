<div align="center">

# 🔐 OpenCoperLock

**A self-hostable private cloud — a clean Drive plus advanced acquisition & security tooling.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![CI](https://github.com/softpython2884/opencoperlock/actions/workflows/ci.yml/badge.svg)](https://github.com/softpython2884/opencoperlock/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)

</div>

OpenCoperLock is an ultra-light, secure private cloud you run on your own dedicated
machine or VM. It pairs a classic file **Drive** with three things most "drop a file"
tools lack: a **nomadic Quick-Upload by code**, a **server-side Remote-Upload from a
link**, and a **hybrid encryption** model that lets you choose between server-side
encryption-at-rest (scannable) and a true client-side **Zero-Knowledge Vault**.

> Built to be read, audited, and forked. AGPLv3 — if you host a modified version, your
> users get the source.

---

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 📁 | **Drive** | Browse, upload (streaming), download and delete files & folders. Per-user quota and a global storage cap. Minimalist UI, no heavy animations. |
| ⚡ | **Quick-Upload by code** | Open a temporary drop zone on any device (phone, third-party PC) by entering an active code — no full login. |
| 🌐 | **Remote-Upload** | Paste a link; the **server** downloads the file directly so your mobile connection (4G/5G) is never saturated. SSRF-guarded. |
| 🛡️ | **Antivirus + VirusTotal** | Files are scanned with ClamAV on upload; optionally checked against the VirusTotal API. Infected files are quarantined. |
| 🔒 | **Hybrid encryption** | Server-side AES-256-GCM at rest by default (so files can be scanned), **plus** an opt-in **Zero-Knowledge Vault** where files are encrypted in your browser and the server stays blind. |
| 👤 | **Admin panel** | Create users, set per-user storage quotas, define the global storage cap, manage Quick-Upload codes, and read the audit log. |

---

## 🏗️ Architecture

A TypeScript monorepo (pnpm workspaces):

```
opencoperlock/
├─ apps/
│  ├─ web/          # Next.js (App Router) — minimalist UI
│  └─ api/          # Fastify API + background worker
├─ packages/
│  └─ shared/       # zod schemas, shared types, crypto helpers
├─ infra/           # docker-compose, Dockerfiles, clamav config
└─ docs/            # ARCHITECTURE, SECURITY, THREAT_MODEL, DEPLOYMENT
```

- **API**: Fastify + Prisma + PostgreSQL. Background jobs run on a DB-backed worker loop
  (no Redis required — Redis/BullMQ is an optional upgrade).
- **Storage**: pluggable driver; ships with a local-filesystem driver, ready for S3-compatible later.
- **Encryption**: see [`docs/SECURITY.md`](./docs/SECURITY.md) and [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md).

Read the full design in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 🚀 Quick start (Docker)

```bash
git clone https://github.com/softpython2884/opencoperlock.git
cd opencoperlock
cp .env.example .env
# Edit .env — set strong values for POSTGRES_PASSWORD, MASTER_KEY,
# SESSION_SECRET, ADMIN_EMAIL and ADMIN_PASSWORD.

docker compose -f infra/docker-compose.yml up --build
```

Then open `http://localhost:3000` and sign in with the admin credentials from your `.env`.

Generate strong secrets:

```bash
# 32-byte base64 keys for MASTER_KEY and SESSION_SECRET
openssl rand -base64 32
```

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for production setup behind a reverse
proxy with TLS (e.g. `copper.forgenet.fr`).

### Quick start (bare-metal / PM2)

Prefer running it natively on a dedicated server? Provide your own PostgreSQL, then:

```bash
cp .env.example .env        # edit secrets + paths
./scripts/deploy.sh         # build, migrate, seed
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup      # restart on reboot
```

Full PM2 walkthrough in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md#bare-metal-with-pm2-dedicated-server).

---

## 🧑‍💻 Local development

```bash
pnpm install
# Start Postgres (and optional ClamAV) however you prefer, then:
pnpm --filter @opencoperlock/api prisma:migrate
pnpm --filter @opencoperlock/api db:seed
pnpm dev
```

Useful root scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format`.

---

## 🔐 Security

Encryption model, trust boundaries and a threat model are documented in
[`docs/SECURITY.md`](./docs/SECURITY.md) and [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md).
To report a vulnerability, see [`SECURITY.md`](./SECURITY.md).

## 🤝 Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) and our
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## 📄 License

[GNU AGPL v3.0 or later](./LICENSE). © OpenCoperLock contributors.
