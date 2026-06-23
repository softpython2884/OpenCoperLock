/**
 * Shared Spaces: collaborative areas owned by one user and shared with a group of members.
 *
 * The whole feature reuses the existing server-side encryption pipeline unchanged — there is NO
 * new cryptography. A space's folders and files are ordinary SERVER-encrypted rows whose
 * `ownerId` is the space owner (so the owner's quota is charged) and whose `spaceId` is set (so
 * they are reachable only through the /spaces routes, never the personal Drive). The only thing
 * that is genuinely new is authorization, and it lives in one place here: `getSpaceAccess`.
 */
import type { SharedSpace } from '@prisma/client';
import type { SpaceAccessRole } from '@opencoperlock/shared';
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';
import { adjustUsage } from './quota.js';

export interface SpaceAccess {
  space: SharedSpace;
  /** The caller's effective role: OWNER (implicit) or their member role. */
  role: SpaceAccessRole;
}

/**
 * Resolve a user's access to a space, or null if they have none. This is the single gate every
 * space route goes through — it replaces, for shared content, the personal Drive's
 * `ownerId === me` filter. Callers derive write permission with `canWrite()`.
 */
export async function getSpaceAccess(userId: string, spaceId: string): Promise<SpaceAccess | null> {
  const space = await prisma.sharedSpace.findUnique({ where: { id: spaceId } });
  if (!space) return null;
  if (space.ownerId === userId) return { space, role: 'OWNER' };
  const member = await prisma.sharedSpaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
  });
  if (!member) return null;
  return { space, role: member.role };
}

/** EDITOR/OWNER may write; VIEWER is read-only. */
export function canWrite(role: SpaceAccessRole): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}

/** All folder ids belonging to a space (optionally restricted to a subtree under `rootId`). */
export async function spaceFolderIds(spaceId: string, rootId?: string): Promise<string[]> {
  if (!rootId) {
    const all = await prisma.folder.findMany({ where: { spaceId }, select: { id: true } });
    return all.map((f) => f.id);
  }
  const ids = [rootId];
  for (let i = 0; i < ids.length; i += 1) {
    const children = await prisma.folder.findMany({
      where: { parentId: ids[i], spaceId },
      select: { id: true },
    });
    ids.push(...children.map((c) => c.id));
  }
  return ids;
}

/** Total bytes stored in a space (live files + their retained versions). */
export async function spaceUsedBytes(spaceId: string): Promise<number> {
  const [files, versions] = await Promise.all([
    prisma.fileObject.aggregate({ where: { spaceId }, _sum: { sizeBytes: true } }),
    prisma.fileVersion.aggregate({ where: { file: { spaceId } }, _sum: { sizeBytes: true } }),
  ]);
  return Number(files._sum.sizeBytes ?? 0n) + Number(versions._sum.sizeBytes ?? 0n);
}

interface PurgeableFile {
  id: string;
  storageKey: string;
  sizeBytes: bigint;
}

/** Delete a set of files' blobs (and their versions' blobs) and remove the rows. Returns bytes
 *  freed; the caller releases that from the owner's quota. */
async function purgeFileRows(ctx: AppContext, files: PurgeableFile[]): Promise<number> {
  let freed = 0;
  for (const f of files) {
    const versions = await prisma.fileVersion.findMany({
      where: { fileId: f.id },
      select: { storageKey: true, sizeBytes: true },
    });
    await ctx.storage.delete(f.storageKey).catch(() => {});
    freed += Number(f.sizeBytes);
    for (const v of versions) {
      await ctx.storage.delete(v.storageKey).catch(() => {});
      freed += Number(v.sizeBytes);
    }
  }
  if (files.length > 0) {
    await prisma.fileObject.deleteMany({ where: { id: { in: files.map((f) => f.id) } } }); // cascades versions
  }
  return freed;
}

/**
 * Permanently delete a space and everything in it: blobs (files + versions) are removed from
 * storage, the owner's quota is released, and the cascade on SharedSpace drops the folders,
 * files and member rows. Used when the owner chooses the "delete" lifecycle mode.
 *
 * Space content is hard-deleted (not sent to a Trash) so it never mixes into the owner's
 * personal Trash, keeping the two areas cleanly isolated.
 */
export async function deleteSpaceCascade(ctx: AppContext, space: SharedSpace): Promise<void> {
  const files = await prisma.fileObject.findMany({
    where: { spaceId: space.id },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  const freed = await purgeFileRows(ctx, files);
  // Deleting the space cascades its remaining folders and member rows at the DB level.
  await prisma.sharedSpace.delete({ where: { id: space.id } });
  if (freed > 0) await adjustUsage(space.ownerId, -freed);
}

/** Permanently delete one file from a space, freeing the owner's quota. */
export async function purgeSpaceFile(ctx: AppContext, space: SharedSpace, fileId: string): Promise<boolean> {
  const file = await prisma.fileObject.findFirst({
    where: { id: fileId, spaceId: space.id },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  if (!file) return false;
  const freed = await purgeFileRows(ctx, [file]);
  if (freed > 0) await adjustUsage(space.ownerId, -freed);
  return true;
}

/** Permanently delete a folder subtree from a space, freeing the owner's quota. */
export async function purgeSpaceFolder(ctx: AppContext, space: SharedSpace, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, spaceId: space.id } });
  if (!folder) return false;
  const ids = await spaceFolderIds(space.id, folderId);
  const files = await prisma.fileObject.findMany({
    where: { folderId: { in: ids }, spaceId: space.id },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  const freed = await purgeFileRows(ctx, files);
  await prisma.folder.deleteMany({ where: { id: { in: ids } } });
  if (freed > 0) await adjustUsage(space.ownerId, -freed);
  return true;
}

/**
 * Hand a space to its earliest-joined member: reassign ownership and move the storage cost from
 * the old owner to the new one. Returns the new owner's id, or null when the space has no member
 * to transfer to (the caller should fall back to deletion). Used for the "transfer" lifecycle.
 *
 * Quota note: the bytes simply move between two users, so the global total is unchanged. If this
 * pushes the new owner over their personal quota, their *future* uploads are blocked but the
 * existing data is never stranded — the least-destructive choice.
 */
export async function transferSpaceToEarliestMember(space: SharedSpace): Promise<string | null> {
  const heir = await prisma.sharedSpaceMember.findFirst({
    where: { spaceId: space.id },
    orderBy: { joinedAt: 'asc' },
  });
  if (!heir) return null;

  const bytes = await spaceUsedBytes(space.id);
  await prisma.$transaction([
    // Re-point every folder & file in the space at the new owner (for quota + cascade ownership).
    prisma.folder.updateMany({ where: { spaceId: space.id }, data: { ownerId: heir.userId } }),
    prisma.fileObject.updateMany({ where: { spaceId: space.id }, data: { ownerId: heir.userId } }),
    prisma.sharedSpace.update({ where: { id: space.id }, data: { ownerId: heir.userId } }),
    // The heir is now the owner, not a member.
    prisma.sharedSpaceMember.delete({ where: { id: heir.id } }),
  ]);
  if (bytes > 0) {
    await adjustUsage(space.ownerId, -bytes);
    await adjustUsage(heir.userId, bytes);
  }
  return heir.userId;
}
