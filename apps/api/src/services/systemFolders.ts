/**
 * Per-user "system" folders for files that would otherwise have nowhere to live:
 *   - Fast-Upload  : everything dropped through a Quick-Upload code, and
 *   - Remote-Upload: everything fetched by a Remote-Upload job
 * when the operation specifies no explicit target. Without these, such files would land at
 * the account root (or be effectively unreachable), so we always route them to a single,
 * predictable, normal (server-encrypted) folder.
 *
 * The folders are created lazily the first time the corresponding feature is used (and
 * eagerly at account creation for Fast-Upload), and re-created if the owner deleted them.
 */
import { FAST_UPLOAD_FOLDER_NAME, REMOTE_UPLOAD_FOLDER_NAME } from '@opencoperlock/shared';
import { prisma } from '../db.js';

/** Return the id of a named, normal root folder for this user, creating it if absent. */
export async function ensureNamedRootFolder(userId: string, name: string): Promise<string> {
  const existing = await prisma.folder.findFirst({
    where: { ownerId: userId, parentId: null, name, isZeroKnowledge: false },
    select: { id: true },
  });
  if (existing) return existing.id;

  const folder = await prisma.folder.create({
    data: { ownerId: userId, parentId: null, name, isZeroKnowledge: false },
    select: { id: true },
  });
  return folder.id;
}

export function ensureFastUploadFolder(userId: string): Promise<string> {
  return ensureNamedRootFolder(userId, FAST_UPLOAD_FOLDER_NAME);
}

export function ensureRemoteUploadFolder(userId: string): Promise<string> {
  return ensureNamedRootFolder(userId, REMOTE_UPLOAD_FOLDER_NAME);
}
