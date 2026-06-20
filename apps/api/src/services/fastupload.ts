/**
 * Every account owns a "Fast-Upload" folder — a normal (server-encrypted) root folder that
 * collects everything dropped through a Quick-Upload code. Code uploads with no explicit
 * target land here, so the owner always has a single, predictable place to find them.
 *
 * The folder is created eagerly on account creation, but `ensureFastUploadFolder` is also a
 * lazy safety net: it (re)creates the folder for older accounts, or if the owner deleted it.
 */
import { FAST_UPLOAD_FOLDER_NAME } from '@opencoperlock/shared';
import { prisma } from '../db.js';

/** Return the id of the user's Fast-Upload folder, creating it at the root if absent. */
export async function ensureFastUploadFolder(userId: string): Promise<string> {
  const existing = await prisma.folder.findFirst({
    where: {
      ownerId: userId,
      parentId: null,
      name: FAST_UPLOAD_FOLDER_NAME,
      isZeroKnowledge: false,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const folder = await prisma.folder.create({
    data: {
      ownerId: userId,
      parentId: null,
      name: FAST_UPLOAD_FOLDER_NAME,
      isZeroKnowledge: false,
    },
    select: { id: true },
  });
  return folder.id;
}
