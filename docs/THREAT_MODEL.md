# Threat model

This document states what OpenCoperLock defends against, what it explicitly does not, and
the residual risks an operator should understand. It is intentionally honest — security
software that overpromises is worse than software that is clear about its boundaries.

## Assets

- **File contents** (SERVER mode — confidential to the operator + users).
- **Vault file contents** (ZK mode — confidential to the user *only*).
- **Credentials & sessions.**
- **Service availability and storage capacity.**

## Trust boundaries

| Actor | SERVER files | ZK vault files |
|-------|--------------|----------------|
| Authenticated user (owner) | read/write | read/write (with passphrase) |
| Other authenticated users | no access | no access |
| Anonymous Quick-Upload guest | write-only, to a code's target folder | never |
| Server operator / DB + `MASTER_KEY` holder | **can decrypt** | **cannot decrypt** |
| Network attacker (no creds) | no access | no access |

## Threats considered & mitigations

| Threat | Mitigation |
|--------|------------|
| Credential theft via DB dump | Argon2id password hashing |
| CSRF | double-submit token on all mutations; SameSite cookies |
| XSS stealing the session | httpOnly cookie (token not readable by JS) |
| Session fixation / stale sessions | server-side sessions, revoked on disable/password change |
| **SSRF** via Remote-Upload | scheme allowlist, per-hop redirect re-validation, private/reserved IP blocking, size cap |
| Path traversal in storage | strict key validation, resolved-path containment check |
| Quota exhaustion / storage DoS | per-user quota + global cap enforced while streaming |
| Brute-force login / API abuse | rate limiting; (per-route login throttling is a planned hardening) |
| Malware distribution | ClamAV scan on ingest; VirusTotal hash lookup; quarantine on hit |
| Tampered ciphertext at rest | AES-GCM authentication (detected on read) |

## Out of scope / residual risks

- **Operator access to SERVER files.** SERVER mode is encryption *at rest*, not against the
  operator. Use a ZK vault for content the operator must not read.
- **DNS rebinding** between the SSRF guard's DNS lookup and the actual fetch is a known
  theoretical gap. Deployments needing strong guarantees should place the API behind an
  egress proxy enforcing the same allowlist.
- **Streaming AEAD ordering.** AES-GCM verifies the auth tag only after the final block, so
  a tampered/truncated blob surfaces as a stream error at the end of a download rather than
  before the first byte. Storage integrity is the first line of defence.
- **ZK metadata.** Vault file *sizes* and *counts* are visible to the server (only the
  content and filenames are encrypted). Per-vault salts and padded sizes are future work.
- **Lost ZK passphrase.** By design, there is no recovery. The operator cannot help.
- **VirusTotal hash submission** reveals a file's SHA-256 to a third party when invoked.
  It is opt-in and never uploads file contents.
- **Endpoint compromise.** A compromised browser/device defeats ZK encryption (the key is
  derived there). OpenCoperLock cannot protect against a malicious client device.

## Hardening checklist for operators

- Set a unique, secret `MASTER_KEY` and `SESSION_SECRET`; store them outside the repo/DB.
- Terminate TLS at a reverse proxy and set `APP_URL` to the `https://` origin.
- Keep ClamAV enabled and its signatures updated.
- Back up Postgres **and** the storage volume together (they are useless apart).
- Restrict who can reach the Postgres and clamav ports (they are internal to the compose network by default).
