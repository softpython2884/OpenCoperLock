/**
 * Per-worker environment defaults for tests. Unit tests need none of this; integration
 * tests use a real Postgres pointed at by DATABASE_URL (or TEST_DATABASE_URL). Secrets are
 * fixed throwaways so `loadEnv()` succeeds.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_ENABLED ??= 'false';
process.env.MASTER_KEY ??= Buffer.alloc(32, 3).toString('base64');
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-16-chars';
process.env.CLAMAV_ENABLED ??= 'false';
process.env.ADMIN_EMAIL ??= 'admin@test.local';
process.env.ADMIN_PASSWORD ??= 'admin-password-123';

if (!process.env.STORAGE_PATH) {
  const base = mkdtempSync(join(tmpdir(), 'ocl-test-'));
  process.env.STORAGE_PATH = join(base, 'storage');
  process.env.QUARANTINE_PATH = join(base, 'quarantine');
}
