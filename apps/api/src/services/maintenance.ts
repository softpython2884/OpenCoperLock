/**
 * Periodic housekeeping. None of this is on the request path; it repairs drift and keeps
 * tables/disk bounded:
 *
 *  - reconcileUsage   — recompute each user's `usedBytes` from their files (heals counter
 *                       drift caused by a crash between a storage write and the DB update);
 *  - collectOrphans   — delete storage blobs with no `FileObject`, older than a grace
 *                       period (so an in-flight upload is never reaped);
 *  - pruneAuditLog / pruneJobs / pruneThrottle — retention so logs never outgrow the data.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';

export interface ReconcileResult {
  usersChecked: number;
  usersAdjusted: number;
}

/** Recompute usedBytes per user from the authoritative sum of their file sizes. */
export async function reconcileUsage(): Promise<ReconcileResult> {
  const users = await prisma.user.findMany({ select: { id: true, usedBytes: true } });
  let adjusted = 0;
  for (const user of users) {
    const agg = await prisma.fileObject.aggregate({
      where: { ownerId: user.id },
      _sum: { sizeBytes: true },
    });
    const actual = agg._sum.sizeBytes ?? 0n;
    if (actual !== user.usedBytes) {
      await prisma.user.update({ where: { id: user.id }, data: { usedBytes: actual } });
      adjusted += 1;
    }
  }
  return { usersChecked: users.length, usersAdjusted: adjusted };
}

export interface OrphanResult {
  scanned: number;
  deleted: number;
}

/**
 * Delete storage blobs that have no corresponding `FileObject` and are older than
 * `graceHours`. The grace period protects the brief window between writing a blob and
 * committing its row. Returns counts; a driver without `list()` yields a no-op.
 */
export async function collectOrphans(
  ctx: AppContext,
  graceHours: number,
  log: FastifyBaseLogger,
): Promise<OrphanResult> {
  if (!ctx.storage.list) return { scanned: 0, deleted: 0 };
  const known = new Set(
    (await prisma.fileObject.findMany({ select: { storageKey: true } })).map((f) => f.storageKey),
  );
  const cutoff = Date.now() - graceHours * 60 * 60 * 1000;
  let scanned = 0;
  let deleted = 0;
  for await (const { key, mtimeMs } of ctx.storage.list()) {
    scanned += 1;
    if (known.has(key) || mtimeMs > cutoff) continue;
    await ctx.storage.delete(key).catch((err) => log.warn({ err, key }, 'orphan delete failed'));
    deleted += 1;
  }
  return { scanned, deleted };
}

/** Delete audit entries older than `retentionDays`. */
export async function pruneAuditLog(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const res = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}

/** Delete finished (DONE/FAILED) remote jobs older than `retentionDays`. */
export async function pruneJobs(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const res = await prisma.remoteUploadJob.deleteMany({
    where: { status: { in: ['DONE', 'FAILED'] }, updatedAt: { lt: cutoff } },
  });
  return res.count;
}

/** Delete throttle counters that are no longer locked and have gone stale. */
export async function pruneThrottle(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const res = await prisma.throttle.deleteMany({
    where: { updatedAt: { lt: cutoff }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
  });
  return res.count;
}

/** Run one full maintenance pass. Safe to call manually (admin) or on a timer. */
export async function runMaintenance(ctx: AppContext, log: FastifyBaseLogger) {
  const reconcile = await reconcileUsage();
  const orphans = await collectOrphans(ctx, ctx.env.ORPHAN_GRACE_HOURS, log);
  const audit = await pruneAuditLog(ctx.env.AUDIT_RETENTION_DAYS);
  const jobs = await pruneJobs(ctx.env.JOB_RETENTION_DAYS);
  const throttle = await pruneThrottle();
  const summary = {
    usersAdjusted: reconcile.usersAdjusted,
    orphansDeleted: orphans.deleted,
    auditPruned: audit,
    jobsPruned: jobs,
    throttlePruned: throttle,
  };
  log.info(summary, 'maintenance pass complete');
  return summary;
}

/** Start a periodic maintenance timer. Returns a stop function. */
export function startMaintenance(ctx: AppContext, log: FastifyBaseLogger): () => void {
  const intervalMs = ctx.env.MAINTENANCE_INTERVAL_HOURS * 60 * 60 * 1000;
  let stopped = false;
  // First pass shortly after boot, then on the configured interval.
  const timer = setInterval(() => {
    if (!stopped) void runMaintenance(ctx, log).catch((err) => log.error({ err }, 'maintenance failed'));
  }, intervalMs);
  const kickoff = setTimeout(() => {
    if (!stopped) void runMaintenance(ctx, log).catch((err) => log.error({ err }, 'maintenance failed'));
  }, 60_000);
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
