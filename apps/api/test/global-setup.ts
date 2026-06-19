/**
 * Applies migrations to the test database once before the integration suite. If no
 * DATABASE_URL is configured, integration tests skip themselves and this is a no-op, so
 * `pnpm test` still runs the unit tests without a database.
 */
import { execSync } from 'node:child_process';

export default function setup() {
  const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('[test] DATABASE_URL not set — integration tests will be skipped.');
    return;
  }
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
