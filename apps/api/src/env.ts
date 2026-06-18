/**
 * Centralised, validated configuration. Every environment variable the API reads
 * passes through this schema once at boot, so the rest of the code can rely on a
 * fully-typed, present config and we fail fast on misconfiguration.
 */
import { z } from 'zod';
import { loadMasterKey } from '@opencoperlock/shared';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),

  MASTER_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(16),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_PATH: z.string().default('/data/storage'),
  QUARANTINE_PATH: z.string().default('/data/quarantine'),

  DEFAULT_USER_QUOTA_BYTES: z.coerce.number().int().nonnegative().default(10_737_418_240),
  REMOTE_UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2_147_483_648),

  CLAMAV_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

  VIRUSTOTAL_API_KEY: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema> & { masterKey: Buffer };

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // Validate and decode the master key once so failures surface at boot, not first upload.
  const masterKey = loadMasterKey(parsed.data.MASTER_KEY);
  cached = { ...parsed.data, masterKey };
  return cached;
}
