/**
 * Quota & global-cap helpers backed by the database. The pure decision logic lives
 * in `@opencoperlock/shared` (checkQuota) so the UI and API agree; this module just
 * gathers the current numbers and adjusts the running totals.
 */
import { checkQuota, type QuotaResult } from '@opencoperlock/shared';
import { prisma } from '../db.js';

const GLOBAL_SETTING_ID = 'global';

/** Sum of all users' stored bytes — the denominator for the global cap. */
export async function getGlobalUsedBytes(): Promise<number> {
  const agg = await prisma.user.aggregate({ _sum: { usedBytes: true } });
  return Number(agg._sum.usedBytes ?? 0n);
}

export async function getGlobalCapBytes(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { id: GLOBAL_SETTING_ID } });
  return Number(setting?.globalStorageCapBytes ?? 0n);
}

/** Check whether `incomingBytes` fits for a given user, hitting both quota and cap. */
export async function canStore(userId: string, incomingBytes: number): Promise<QuotaResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [globalUsedBytes, globalCapBytes] = await Promise.all([
    getGlobalUsedBytes(),
    getGlobalCapBytes(),
  ]);
  return checkQuota({
    usedBytes: Number(user.usedBytes),
    userQuotaBytes: user.quotaBytes === null ? null : Number(user.quotaBytes),
    globalUsedBytes,
    globalCapBytes,
    incomingBytes,
  });
}

/** The largest single upload a user may currently store (used to cap streams). */
export async function remainingAllowance(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [globalUsedBytes, globalCapBytes] = await Promise.all([
    getGlobalUsedBytes(),
    getGlobalCapBytes(),
  ]);
  const userRemaining =
    user.quotaBytes === null ? Infinity : Number(user.quotaBytes) - Number(user.usedBytes);
  const globalRemaining = globalCapBytes === 0 ? Infinity : globalCapBytes - globalUsedBytes;
  return Math.max(0, Math.min(userRemaining, globalRemaining));
}

/** Adjust a user's running total after a successful upload (+) or delete (-). */
export async function adjustUsage(userId: string, deltaBytes: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { usedBytes: { increment: BigInt(deltaBytes) } },
  });
}
