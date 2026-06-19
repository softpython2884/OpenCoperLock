/**
 * Persistent brute-force throttle. Backs the login lockout and the Quick-Upload password
 * ban on a single `Throttle` row per (bucket, key). The backoff schedule itself lives in
 * `@opencoperlock/shared` (lockDurationMs) so it can be unit-tested without a database.
 */
import { lockDurationMs, type ThrottlePolicy } from '@opencoperlock/shared';
import { prisma } from '../db.js';

export interface LockState {
  locked: boolean;
  /** Seconds until the lock lifts (for a Retry-After header / message). */
  retryAfterSec: number;
}

/** Whether the (bucket, key) pair is currently locked out. */
export async function checkLock(bucket: string, key: string): Promise<LockState> {
  const row = await prisma.throttle.findUnique({ where: { bucket_key: { bucket, key } } });
  if (!row?.lockedUntil) return { locked: false, retryAfterSec: 0 };
  const remaining = row.lockedUntil.getTime() - Date.now();
  if (remaining <= 0) return { locked: false, retryAfterSec: 0 };
  return { locked: true, retryAfterSec: Math.ceil(remaining / 1000) };
}

/**
 * Record a failed attempt and return the resulting lock state. The failure counter resets
 * once the policy window has elapsed since the first failure, so honest users who err
 * occasionally are never permanently penalised.
 */
export async function recordFailure(
  bucket: string,
  key: string,
  policy: ThrottlePolicy,
): Promise<LockState> {
  const now = Date.now();
  const existing = await prisma.throttle.findUnique({ where: { bucket_key: { bucket, key } } });

  // Start a fresh window if there is none or the previous one has expired.
  const windowExpired =
    !existing || now - existing.firstFailAt.getTime() > policy.windowMs;
  const failures = windowExpired ? 1 : existing.failures + 1;
  const firstFailAt = windowExpired ? new Date(now) : existing.firstFailAt;

  const lockMs = lockDurationMs(failures, policy);
  const lockedUntil = lockMs > 0 ? new Date(now + lockMs) : null;

  await prisma.throttle.upsert({
    where: { bucket_key: { bucket, key } },
    create: { bucket, key, failures, firstFailAt, lockedUntil },
    update: { failures, firstFailAt, lockedUntil },
  });

  return {
    locked: lockedUntil !== null,
    retryAfterSec: lockMs > 0 ? Math.ceil(lockMs / 1000) : 0,
  };
}

/** Clear the counter after a successful attempt. */
export async function clearFailures(bucket: string, key: string): Promise<void> {
  await prisma.throttle.deleteMany({ where: { bucket, key } });
}
