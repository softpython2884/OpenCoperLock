import type { Env } from './env.js';
import { createStorage, type StorageDriver } from './storage/index.js';
import { ClamAvScanner } from './security/clamav.js';
import { VirusTotalClient } from './security/virustotal.js';

/**
 * Shared services constructed once at boot and threaded through routes via
 * `fastify.decorate('ctx', ...)`. Keeps route handlers free of singletons and
 * makes the whole graph trivial to assemble in tests.
 */
export interface AppContext {
  env: Env;
  storage: StorageDriver;
  scanner: ClamAvScanner;
  virustotal: VirusTotalClient;
}

export function createContext(env: Env): AppContext {
  return {
    env,
    storage: createStorage(env),
    scanner: new ClamAvScanner({
      enabled: env.CLAMAV_ENABLED,
      host: env.CLAMAV_HOST,
      port: env.CLAMAV_PORT,
    }),
    virustotal: new VirusTotalClient(env.VIRUSTOTAL_API_KEY),
  };
}
