/**
 * Load environment variables from `.env` files for bare-metal / PM2 deployments.
 *
 * Resolution order (first definition wins, matching dotenv's no-override default):
 *   1. variables already in the process environment (e.g. set by PM2 or systemd),
 *   2. `apps/api/.env` (local override),
 *   3. the repository-root `.env` (the one in `.env.example`).
 *
 * In Docker we pass env directly, so the files simply won't exist and this is a no-op.
 * Must be imported before any module that reads `process.env` (see index.ts).
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [
  resolve(process.cwd(), '.env'), // when cwd is apps/api
  resolve(process.cwd(), '../../.env'), // repo root from apps/api
  resolve(process.cwd(), 'apps/api/.env'), // when cwd is repo root
];

for (const path of candidates) {
  if (existsSync(path)) config({ path });
}
