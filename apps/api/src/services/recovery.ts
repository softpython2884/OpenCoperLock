/**
 * One-time recovery codes — a fallback when an authenticator device is lost. Codes are
 * shown to the user exactly once and stored only as SHA-256 hashes. They are
 * high-entropy and single-use, and login is rate-limited/locked out, so a fast hash is
 * appropriate (argon2 over ten candidates per attempt would be needlessly slow).
 */
import { randomInt } from 'node:crypto';
import { sha256Hex } from '@opencoperlock/shared';
import { prisma } from '../db.js';

const CODE_COUNT = 10;

/** A 10-digit code formatted as `XXXXX-XXXXX` for readability. */
function makeCode(): string {
  let digits = '';
  for (let i = 0; i < 10; i += 1) digits += randomInt(0, 10).toString();
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Normalize user input (strip spaces/dashes) before hashing/comparison. */
function normalize(code: string): string {
  return code.replace(/[\s-]/g, '');
}

function hash(code: string): string {
  return sha256Hex(normalize(code));
}

/**
 * Replace a user's recovery codes with a fresh set. Returns the plaintext codes to show
 * once; only their hashes are persisted.
 */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: CODE_COUNT }, makeCode);
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: hash(c) })),
    }),
  ]);
  return codes;
}

/** Consume a recovery code if it matches an unused one. Returns true on success. */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const match = await prisma.recoveryCode.findFirst({
    where: { userId, codeHash: hash(code), usedAt: null },
  });
  if (!match) return false;
  await prisma.recoveryCode.update({ where: { id: match.id }, data: { usedAt: new Date() } });
  return true;
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}

export async function clearRecoveryCodes(userId: string): Promise<void> {
  await prisma.recoveryCode.deleteMany({ where: { userId } });
}
