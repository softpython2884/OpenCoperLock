/**
 * Remote-Upload worker. A single in-process loop polls the `RemoteUploadJob` table,
 * leases one queued job at a time (atomic status flip), downloads it through the
 * SSRF-guarded fetcher, runs it through the same ingest pipeline as a normal upload,
 * and records the result.
 *
 * Keeping the queue in Postgres (rather than Redis/BullMQ) keeps the deployment to a
 * single moving part. The lease flip means even multiple API replicas won't double-
 * process a job; horizontal scaling and retries are noted as future work.
 */
import type { FastifyBaseLogger } from 'fastify';
import { SsrfError } from '@opencoperlock/shared';
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';
import { newStorageKey } from '../storage/index.js';
import { ingestPlaintext, FileTooLargeError, InfectedFileError } from '../services/ingest.js';
import { openRemoteSource } from '../services/remote.js';
import { adjustUsage, remainingAllowance } from '../services/quota.js';

const POLL_INTERVAL_MS = 2_000;

/** Atomically claim the oldest queued job, or return null if none is waiting. */
async function leaseJob() {
  const candidate = await prisma.remoteUploadJob.findFirst({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
  });
  if (!candidate) return null;
  // Only the worker that flips QUEUED -> RUNNING owns the job.
  const claimed = await prisma.remoteUploadJob.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: { status: 'RUNNING', startedAt: new Date() },
  });
  if (claimed.count === 0) return null; // lost the race
  return prisma.remoteUploadJob.findUnique({ where: { id: candidate.id } });
}

async function processJob(ctx: AppContext, jobId: string, log: FastifyBaseLogger): Promise<void> {
  const job = await prisma.remoteUploadJob.findUnique({ where: { id: jobId } });
  if (!job) return;

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
      data: { status: 'DONE', fileId: file.id, sizeBytes: BigInt(result.sizeBytes), error: null },
    });
    log.info({ jobId: job.id, fileId: file.id }, 'remote-upload completed');
  } catch (err) {
    await ctx.storage.delete(storageKey).catch(() => {});
    const message =
      err instanceof SsrfError
        ? `Blocked: ${err.message}`
        : err instanceof FileTooLargeError
          ? 'File exceeds the allowed size'
          : err instanceof InfectedFileError
            ? `Rejected by antivirus: ${err.signature}`
            : err instanceof Error
              ? err.message
              : 'Unknown error';
    await prisma.remoteUploadJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: message },
    });
    log.warn({ jobId: job.id, err }, 'remote-upload failed');
  }
}

/** Start the polling loop. Returns a stop function for graceful shutdown/tests. */
export function startRemoteWorker(ctx: AppContext, log: FastifyBaseLogger): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const job = await leaseJob();
      if (job) await processJob(ctx, job.id, log);
    } catch (err) {
      log.error({ err }, 'remote worker tick failed');
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  // Recover jobs left RUNNING by a crashed previous process.
  prisma.remoteUploadJob
    .updateMany({ where: { status: 'RUNNING' }, data: { status: 'QUEUED', startedAt: null } })
    .catch((err) => log.warn({ err }, 'failed to requeue stale remote jobs'))
    .finally(() => {
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    });

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
