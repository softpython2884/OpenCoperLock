#!/usr/bin/env bash
# Apply database migrations and seed the first admin, then launch the API.
# Idempotent: `migrate deploy` only applies pending migrations, the seed leaves an
# existing admin untouched.
set -euo pipefail

cd /app/apps/api

echo "[entrypoint] applying database migrations…"
pnpm exec prisma migrate deploy

echo "[entrypoint] seeding (idempotent)…"
pnpm exec tsx prisma/seed.ts || echo "[entrypoint] seed skipped/failed (continuing)"

echo "[entrypoint] starting API…"
exec node dist/index.js
