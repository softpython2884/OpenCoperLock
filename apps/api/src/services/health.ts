/**
 * Readiness checks. `/ready` gates traffic (load balancers, the deploy script), while the
 * authenticated `/status` endpoint surfaces non-fatal warnings to the UI so a signed-in
 * user is told when something is degraded (e.g. antivirus offline).
 */
import { Readable } from 'node:stream';
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';

export type ComponentState = 'ok' | 'degraded' | 'down' | 'disabled';

export interface HealthReport {
  /** Overall readiness: false if a hard dependency (DB or storage) is down. */
  ready: boolean;
  checks: {
    database: ComponentState;
    storage: ComponentState;
    antivirus: ComponentState;
  };
  /** Human-readable warnings for the UI banner (empty when all good). */
  warnings: string[];
}

const PROBE_KEY = '00/00/healthprobe';

async function checkDatabase(): Promise<ComponentState> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkStorage(ctx: AppContext): Promise<ComponentState> {
  try {
    await ctx.storage.write(PROBE_KEY, Readable.from(Buffer.from('ok')));
    await ctx.storage.delete(PROBE_KEY);
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkAntivirus(ctx: AppContext): Promise<ComponentState> {
  if (!ctx.scanner.isEnabled) return 'disabled';
  return (await ctx.scanner.ping()) ? 'ok' : 'down';
}

export async function getHealth(ctx: AppContext): Promise<HealthReport> {
  const [database, storage, antivirus] = await Promise.all([
    checkDatabase(),
    checkStorage(ctx),
    checkAntivirus(ctx),
  ]);

  const warnings: string[] = [];
  if (database === 'down') warnings.push('The database is unreachable.');
  if (storage === 'down') warnings.push('File storage is not writable.');
  if (antivirus === 'down') {
    warnings.push('Antivirus scanning is enabled but the scanner is offline; uploads are not being scanned.');
  }

  return {
    ready: database === 'ok' && storage === 'ok',
    checks: { database, storage, antivirus },
    warnings,
  };
}
