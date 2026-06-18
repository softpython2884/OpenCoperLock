# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public issue.

- Use GitHub's **"Report a vulnerability"** feature (Security → Advisories) on the
  repository, or
- email the maintainer at the address listed on the project profile.

Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- affected version / commit.

We aim to acknowledge reports within a few days and will keep you updated as we work on a
fix. Please give us a reasonable window to remediate before any public disclosure.

## Scope

In scope: the API, web app, and the encryption / SSRF / quota logic in this repository.

Out of scope: issues in third-party dependencies (report upstream), and the documented
residual risks in [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md) (e.g. that an operator
can decrypt `SERVER`-mode files — use a Zero-Knowledge vault for operator-private data).

## Supported versions

OpenCoperLock is pre-1.0; security fixes target the `main` branch. Pin to a commit and
update regularly until tagged releases are published.
