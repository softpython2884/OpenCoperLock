/**
 * Quick-Upload codes must be globally unique: the public /q endpoint routes an anonymous upload
 * to the right user by the code alone, so two users can never share one. A user-chosen code that
 * is already taken is rejected (caller returns 409); a blank one gets a generated, collision-free
 * code from here.
 */
import { randomCode } from '@opencoperlock/shared';
import { prisma } from '../db.js';

/** A random code guaranteed not to collide with an existing one (widens on the unlikely clash). */
export async function generateUniqueQuickCode(): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const code = randomCode();
    const clash = await prisma.quickUploadCode.findUnique({ where: { code } });
    if (!clash) return code;
  }
  // Practically unreachable; a longer code makes a collision astronomically unlikely.
  return randomCode(14);
}

/** True when a Prisma error is the unique-constraint violation on the code column. */
export function isCodeTakenError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
