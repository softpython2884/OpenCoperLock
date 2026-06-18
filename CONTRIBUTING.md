# Contributing to OpenCoperLock

Thanks for your interest! OpenCoperLock is built to be read and audited, so contributions
that improve clarity and security are especially welcome.

## Development setup

```bash
pnpm install
pnpm --filter @opencoperlock/shared build      # build the shared package once
pnpm --filter @opencoperlock/api prisma:generate
pnpm dev                                        # web + api in watch mode
```

You'll need a local PostgreSQL for the API. ClamAV is optional in dev (uploads are marked
`unscanned` when it's unreachable).

## Before you open a PR

Run the same gates CI runs:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

- Match the surrounding style; the repo is Prettier- and ESLint-formatted (`pnpm format`).
- Keep functions small and the security-critical paths (`packages/shared/src/crypto.ts`,
  `ssrf.ts`, `apps/api/src/services/ingest.ts`) well-commented.
- Add tests for logic with branches — crypto, quota, SSRF, validation.

## Security-sensitive changes

If your change touches authentication, encryption, the SSRF/quota guards, or the trust
boundary, please read [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md) and call out the
implications in your PR description.

**Do not** open a public issue for a vulnerability — follow [`SECURITY.md`](./SECURITY.md).

## Commit & PR conventions

- Write descriptive commit messages (imperative mood: "Add…", "Fix…").
- One logical change per PR where possible.
- Fill in the PR template checklist.

## License

By contributing, you agree your contributions are licensed under the project's
[AGPL-3.0-or-later](./LICENSE).
