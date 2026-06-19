/**
 * Remote-Upload worker. A single in-process loop polls the `RemoteUploadJob` table,
 * leases one due job at a time (atomic status flip), downloads it through the
 * SSRF-guarded fetcher with a transfer timeout, runs it through the shared ingest
 * pipeline, and records the result.
 *
 * Robustness:
 *  - transient failures (network, 5xx, timeout) are retried up to MAX_ATTEMPTS with
 *    exponential backoff via `nextRunAt`; permanent ones (SSRF, 4xx, infected, too large,
 *    out of space) fail immediately;
 *  - a job stuck in RUNNING (e.g. the process was killed mid-download) is reclaimed once
 *    its lease expires, so work never disappears.
 *
 * Keeping the queue in Postgres avoids a Redis dependency; horizontal scaling would move
 * this to a dedicated worker + BullMQ.
 */
import type { FastifyBaseLogger } from 'fastify';
import { SsrfError } from '@opencoperlock/shared';
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';
import { newStorageKey } from '../storage/index.js';
import { ingestPlaintext, FileTooLargeError, InfectedFileError } from '../services/ingest.js';
import { openRemoteSource, RemoteHttpError } from '../services/remote.js';
import { adjustUsage, remainingAllowance } from '../services/quota.js';

const POLL_INTERVAL_MS = 2_000;
const MAX_ATTEMPTS = 3;
const LEASE_TIMEOUT_MS = 15 * 60 * 1000; // a RUNNING job older than this is presumed dead

/** Backoff before the next attempt: 15s, 60s, 240s … */
function backoffMs(attempts: number): number {
  return Math.min(15_000 * 4 ** (attempts - 1), 60 * 60 * 1000);
}

/** Permanent failures should not be retried. */
function isPermanent(err: unknown): boolean {
  if (err instanceof SsrfError) return true;
  if (err instanceof InfectedFileError) return true;
  if (err instanceof FileTooLargeError) return true;
  if (err instanceof RemoteHttpError) return err.status >= 400 && err.status < 500;
  if (err instanceof Error && err.message.includes('out of space')) return true;
  return false;
}

function describe(err: unknown): string {
  if (err instanceof SsrfError) return `Blocked: ${err.message}`;
  if (err instanceof FileTooLargeError) return 'File exceeds the allowed size';
  if (err instanceof InfectedFileError) return `Rejected by antivirus: ${err.signature}`;
  if (err instanceof RemoteHttpError) return err.message;
  if (err instanceof Error && err.name === 'TimeoutError') return 'Remote download timed out';
  return err instanceof Error ? err.message : 'Unknown error';
}

/** Reclaim jobs whose RUNNING lease has expired (crashed worker) back to QUEUED. */
async function reclaimStale(): Promise<number> {
  const cutoff = new Date(Date.now() - LEASE_TIMEOUT_MS);
  const res = await prisma.remoteUploadJob.updateMany({
    where: { status: 'RUNNING', startedAt: { lt: cutoff } },
    data: { status: 'QUEUED', startedAt: null },
  });
  return res.count;
}

/** Atomically claim the oldest *due* queued job, or return null if none is ready. */
async function leaseJob() {
  const now = new Date();
  const candidate = await prisma.remoteUploadJob.findFirst({
    where: { status: 'QUEUED', OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;
  const claimed = await prisma.remoteUploadJob.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: { status: 'RUNNING', startedAt: now },
  });
  if (claimed.count === 0) return null; // lost the race to another tick
  return prisma.remoteUploadJob.findUnique({ where: { id: candidate.id } });
}

async function processJob(ctx: AppContext, jobId: string, log: FastifyBaseLogger): Promise<void> {
  const job = await prisma.remoteUploadJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const attempts = job.attempts + 1;

  const storageKey = newStorageKey();
  try {
    const allowance = await remainingAllowance(job.ownerId);
    const maxBytes = Math.min(allowance, ctx.env.REMOTE_UPLOAD_MAX_BYTES);
    if (maxBytes <= 0) throw new Error('Destination is out of space');

    const source = await openRemoteSource(job.sourceUrl);
    const result = await ingestPlaintext(ctx, source.body, { maxBytes, storageKey });

    const file = await prisma.fileObject.create({
      data: {
        ownerId: job.ownerId,
        folderId: job.folderId,
        name: source.filename,
        sizeBytes: BigInt(result.sizeBytes),
        mimeType: source.mimeType,
        storageKey: result.storageKey,
        encMode: 'SERVER',
        wrappedKey: result.wrappedKey,
        iv: result.iv,
        authTag: result.authTag,
        sha256: result.sha256,
        avStatus: result.avStatus,
      },
    });
    await adjustUsage(job.ownerId, result.sizeBytes);
    await prisma.remoteUploadJob.update({
      where: { id: job.id },
      data: { status: 'DONE', fileId: file.id, sizeBytes: BigInt(result.sizeBytes), error: null, attempts },
    });
    log.info({ jobId: job.id, fileId: file.id }, 'remote-upload completed');
  } catch (err) {
    await ctx.storage.delete(storageKey).catch(() => {});
    const message = describe(err);
    const retryable = !isPermanent(err) && attempts < MAX_ATTEMPTS;
    if (retryable) {
      const delay = backoffMs(attempts);
      await prisma.remoteUploadJob.update({
        where: { id: job.id },
        data: {
          status: 'QUEUED',
          startedAt: null,
          attempts,
          nextRunAt: new Date(Date.now() + delay),
          error: `${message} (retrying, attempt ${attempts}/${MAX_ATTEMPTS})`,
        },
      });
      log.warn({ jobId: job.id, attempts, delay, err }, 'remote-upload failed, will retry');
    } else {
      await prisma.remoteUploadJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', attempts, error: message },
      });
      log.warn({ jobId: job.id, attempts, err }, 'remote-upload failed permanently');
    }
  }
}

/** Start the polling loop. Returns a stop function for graceful shutdown/tests. */
export function startRemoteWorker(ctx: AppContext, log: FastifyBaseLogger): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await reclaimStale();
      const job = await leaseJob();
      if (job) await processJob(ctx, job.id, log);
    } catch (err) {
      log.error({ err }, 'remote worker tick failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  timer = setTimeout(tick, POLL_INTERVAL_MS);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
