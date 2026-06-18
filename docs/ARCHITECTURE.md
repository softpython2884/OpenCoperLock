# Architecture

OpenCoperLock is a TypeScript monorepo with two deployable apps and one shared library.

```
┌─────────────┐        ┌──────────────────────────────┐
│   Browser   │──HTTP──▶│  web  (Next.js App Router)   │   minimalist SPA
└─────────────┘        └──────────────┬───────────────┘
        │  (XHR, cookie + CSRF)        │
        ▼                              ▼
┌────────────────────────────────────────────────────────┐
│  api  (Fastify)                                         │
│   routes ─ services (ingest / download / quota / …)     │
│   ├─ auth + sessions (cookie, CSRF)                     │
│   ├─ storage driver (local FS, pluggable)               │
│   ├─ ClamAV client  ─┐                                  │
│   ├─ VirusTotal      │ security                         │
│   └─ Remote-Upload worker (in-process, DB-queued)       │
└───────┬───────────────┬───────────────┬────────────────┘
        │               │               │
   ┌────▼────┐    ┌──────▼─────┐   ┌─────▼──────┐
   │Postgres │    │  Storage   │   │  clamd     │
   │(Prisma) │    │ (encrypted │   │ (optional) │
   │         │    │   blobs)   │   │            │
   └─────────┘    └────────────┘   └────────────┘
```

## Packages

| Path | Name | Responsibility |
|------|------|----------------|
| `packages/shared` | `@opencoperlock/shared` | zod schemas, DTO types, constants, **server crypto** (envelope encryption), **SSRF guard**, **quota math**. The browser imports the Node-free subset via `@opencoperlock/shared/client`. |
| `apps/api` | `@opencoperlock/api` | Fastify HTTP API + the Remote-Upload worker. Owns Prisma/Postgres, storage, scanning. |
| `apps/web` | `@opencoperlock/web` | Next.js SPA. Talks to the API with cookies + CSRF; performs all Zero-Knowledge crypto in the browser. |

## Request lifecycle (server-side upload)

1. `POST /files` (multipart, streaming) with the session cookie + CSRF header.
2. `requireAuth` resolves the session and enforces CSRF.
3. `remainingAllowance()` computes how many bytes the user may still store.
4. `ingestPlaintext()` spools the stream to a temp file (measuring size + SHA-256,
   aborting past the allowance), **antivirus-scans** the plaintext, then **encrypts** it
   to storage with a fresh AES-256-GCM data key wrapped by the deployment `MASTER_KEY`.
5. A `FileObject` row records metadata + wrapped key + IV + auth tag; the user's
   `usedBytes` is incremented. Download reverses the process.

The same `ingestPlaintext()` pipeline backs **Quick-Upload** and **Remote-Upload**, so
all three share identical scanning, encryption and quota behaviour.

## Background jobs

Remote-Upload runs on a single in-process polling loop (`worker/remote-worker.ts`) that
leases one `RemoteUploadJob` at a time via an atomic `QUEUED → RUNNING` status flip. This
keeps the deployment to one moving part (no Redis). Redis/BullMQ is a documented upgrade
for horizontal scale.

## Storage abstraction

`StorageDriver` (`apps/api/src/storage/types.ts`) is a tiny interface over opaque blobs.
The shipped `LocalStorageDriver` writes sharded `ab/cd/<id>` paths with traversal-safe key
validation. An S3-compatible driver can implement the same interface without touching routes.

## Data model

See `apps/api/prisma/schema.prisma`. Notable fields:

- `FileObject.encMode` — `SERVER` (envelope-encrypted, scannable) or `ZK` (client-encrypted, opaque).
- SERVER files carry `wrappedKey` / `iv` / `authTag`; ZK files carry `zkEncryptedName` /
  `zkWrappedKey` / `zkIv`, all opaque to the server.
- `User.usedBytes` is a denormalised running total kept in sync on upload/delete.
