// Side-effect import: must come first so .env is loaded before anything reads process.env.
import './config/dotenv.js';
import { setDefaultResultOrder } from 'node:dns';
import { mkdir } from 'node:fs/promises';
import { loadEnv } from './env.js';
import { createContext } from './context.js';
import { buildServer } from './server.js';
import { startRemoteWorker } from './worker/remote-worker.js';
import { startMaintenance } from './services/maintenance.js';
import { prisma } from './db.js';

// Prefer IPv4 when resolving outbound hosts. Some self-hosted boxes advertise IPv6 but have
// no working IPv6 route (or no AAAA records), which makes Node's fetch hang until it times out
// — e.g. the GitHub update check. Resolving IPv4-first mirrors `curl -4` and avoids the stall.
setDefaultResultOrder('ipv4first');

async function main(): Promise<void> {
  const env = loadEnv();
  const ctx = createContext(env);

  // Ensure storage directories exist for the local driver.
  if (env.STORAGE_DRIVER === 'local') {
    await mkdir(env.STORAGE_PATH, { recursive: true });
    await mkdir(env.QUARANTINE_PATH, { recursive: true });
  }

  const app = await buildServer(ctx);
  const stopWorker = startRemoteWorker(ctx, app.log);
  const stopMaintenance = startMaintenance(ctx, app.log);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopWorker();
    stopMaintenance();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
