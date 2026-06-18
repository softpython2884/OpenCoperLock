# Security model

OpenCoperLock uses a **hybrid** encryption model so it can offer both server-side
security features (antivirus, VirusTotal, Remote-Upload, Quick-Upload) *and* true
zero-knowledge privacy where you want it.

## Two encryption modes

### 1. Server-side encryption at rest (default — `SERVER`)

Every file gets a fresh random **Data Encryption Key (DEK)**. The file bytes are sealed
with **AES-256-GCM**, and the DEK is then **wrapped** (encrypted) with the deployment-wide
**Master Key (KEK)**, which is supplied via the `MASTER_KEY` environment variable. Only the
wrapped DEK, IV, and GCM auth tag are stored alongside the ciphertext.

```
file ──AES-256-GCM(DEK)──▶ ciphertext on disk
DEK  ──AES-256-GCM(KEK)──▶ wrappedKey in Postgres
```

Because the server can decrypt these files, it can:

- antivirus-scan the plaintext **before** it is written to disk,
- look files up on VirusTotal by hash,
- accept Remote-Upload and Quick-Upload content.

**Trust assumption:** an operator (or anyone with both the database and `MASTER_KEY`) can
decrypt SERVER files. Keep `MASTER_KEY` out of the database and out of version control. For
the strongest separation, store it in a secrets manager and inject it at runtime.

### 2. Zero-Knowledge Vault (opt-in — `ZK`)

Files placed in a vault folder are encrypted **in the browser** with the Web Crypto API
before they ever leave the device:

- a **vault key** is derived from your passphrase with **PBKDF2-SHA256** (≥210 000 iterations),
- each file gets a random AES-256-GCM data key that encrypts the content **and** the filename,
- that data key is **wrapped with the vault key**.

The server stores only ciphertext, the wrapped key and IVs. It **cannot** read vault files,
recover them if you lose the passphrase, or scan them. ZK folders are therefore excluded
from antivirus, VirusTotal, Remote-Upload and Quick-Upload by design.

## Authentication & sessions

- Passwords are hashed with **Argon2id** (memory-hard).
- Sessions are server-side rows referenced by a **signed, httpOnly, SameSite=Lax cookie**
  (`Secure` in production).
- Mutating requests require a **double-submit CSRF token** (`x-ocl-csrf`) equal to the
  per-session secret — an attacker on another origin can read neither the cookie nor set
  the custom header.
- Disabling a user or changing their password invalidates all their sessions.

## Network-facing hardening

- `@fastify/helmet` security headers and `@fastify/rate-limit` on all routes.
- Strict **zod** validation on every request body / param.
- **SSRF guard** for Remote-Upload: http(s) only, redirects re-validated per hop, every
  resolved IP checked against private/reserved ranges (incl. `169.254.169.254`).
- Path-traversal-safe storage keys; infected files are quarantined, never served.
- Best-effort **audit log** of security-relevant actions.

## Reporting a vulnerability

See [`/SECURITY.md`](../SECURITY.md) at the repository root.
