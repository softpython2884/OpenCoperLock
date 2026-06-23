/**
 * Trash (soft-delete) for files and folders. Deleting moves an item to the Trash by setting
 * `deletedAt` instead of destroying it; the user can restore it or purge it permanently, and
 * the maintenance loop purges anything left in the Trash beyond the retention window.
 *
 * Trashing a folder cascades `deletedAt` to its whole subtree so nothing reappears in the
 * Drive. Trashed files keep counting against quota until they are permanently removed — quota
 * is only released on purge.
 */
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';
import { adjustUsage } from './quota.js';

/** Collect a folder's id plus all descendant folder ids (breadth-first), scoped to an owner. */
async function subtreeFolderIds(ownerId: string, rootId: string): Promise<string[]> {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i += 1) {
    const children = await prisma.folder.findMany({
      where: { parentId: ids[i], ownerId, spaceId: null },
      select: { id: true },
    });
    ids.push(...children.map((c) => c.id));
  }
  return ids;
}

// ── Soft-delete ──────────────────────────────────────────────────────────────

export async function trashFile(ownerId: string, fileId: string): Promise<boolean> {
  const res = await prisma.fileObject.updateMany({
    where: { id: fileId, ownerId, spaceId: null, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return res.count > 0;
}

export async function trashFolder(ownerId: string, folderId: string): Promise<boolean> {
  const owned = await prisma.folder.findFirst({ where: { id: folderId, ownerId, spaceId: null, deletedAt: null } });
  if (!owned) return false;
  const ids = await subtreeFolderIds(ownerId, folderId);
  const now = new Date();
  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: now } }),
    prisma.fileObject.updateMany({ where: { folderId: { in: ids }, deletedAt: null }, data: { deletedAt: now } }),
  ]);
  return true;
}

// ── Restore ──────────────────────────────────────────────────────────────────

export async function restoreFile(ownerId: string, fileId: string): Promise<boolean> {
  const file = await prisma.fileObject.findFirst({ where: { id: fileId, ownerId, spaceId: null, deletedAt: { not: null } } });
  if (!file) return false;
  // If the file's folder is gone or still trashed, restore it to the account root.
  let folderId = file.folderId;
  if (folderId) {
    const parent = await prisma.folder.findFirst({ where: { id: folderId, ownerId, spaceId: null } });
    if (!parent || parent.deletedAt) folderId = null;
  }
  await prisma.fileObject.update({ where: { id: fileId }, data: { deletedAt: null, folderId } });
  return true;
}

export async function restoreFolder(ownerId: string, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId, spaceId: null, deletedAt: { not: null } } });
  if (!folder) return false;
  const ids = await subtreeFolderIds(ownerId, folderId);
  // If the parent is gone or still trashed, restore this folder to the root.
  let parentId = folder.parentId;
  if (parentId) {
    const parent = await prisma.folder.findFirst({ where: { id: parentId, ownerId, spaceId: null } });
    if (!parent || parent.deletedAt) parentId = null;
  }
  await prisma.$transaction([
    prisma.folder.update({ where: { id: folderId }, data: { parentId } }),
    prisma.folder.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } }),
    prisma.fileObject.updateMany({ where: { folderId: { in: ids } }, data: { deletedAt: null } }),
  ]);
  return true;
}

// ── Purge (permanent) ──────────────────────────────────────────────────────--

/** Permanently delete a set of files (blobs + versions) and release their quota. */
async function purgeFiles(ctx: AppContext, ownerId: string, files: { id: string; storageKey: string; sizeBytes: bigint }[]) {
  let freed = 0;
  for (const f of files) {
    const versions = await prisma.fileVersion.findMany({ where: { fileId: f.id } });
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
  if (freed > 0) await adjustUsage(ownerId, -freed);
  return freed;
}

export async function purgeFile(ctx: AppContext, ownerId: string, fileId: string): Promise<boolean> {
  const file = await prisma.fileObject.findFirst({
    where: { id: fileId, ownerId, spaceId: null, deletedAt: { not: null } },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  if (!file) return false;
  await purgeFiles(ctx, ownerId, [file]);
  return true;
}

export async function purgeFolder(ctx: AppContext, ownerId: string, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId, spaceId: null, deletedAt: { not: null } } });
  if (!folder) return false;
  const ids = await subtreeFolderIds(ownerId, folderId);
  const files = await prisma.fileObject.findMany({
    where: { folderId: { in: ids } },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  await purgeFiles(ctx, ownerId, files);
  // Delete deepest folders first so parent FK constraints are satisfied.
  await prisma.folder.deleteMany({ where: { id: { in: ids } } });
  return true;
}

// ── Permanent delete (no Trash) ──────────────────────────────────────────────

/**
 * Permanently delete a file immediately, bypassing the Trash. Used for Zero-Knowledge content:
 * it is opaque ciphertext the server can't preview or restore meaningfully, so a recoverable
 * Trash adds no value — deleting means gone.
 */
export async function hardDeleteFile(ctx: AppContext, ownerId: string, fileId: string): Promise<boolean> {
  const file = await prisma.fileObject.findFirst({
    where: { id: fileId, ownerId, spaceId: null },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  if (!file) return false;
  await purgeFiles(ctx, ownerId, [file]);
  return true;
}

/** Permanently delete a folder subtree immediately, bypassing the Trash (Zero-Knowledge vaults). */
export async function hardDeleteFolder(ctx: AppContext, ownerId: string, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId, spaceId: null } });
  if (!folder) return false;
  const ids = await subtreeFolderIds(ownerId, folderId);
  const files = await prisma.fileObject.findMany({
    where: { folderId: { in: ids } },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  await purgeFiles(ctx, ownerId, files);
  await prisma.folder.deleteMany({ where: { id: { in: ids } } });
  return true;
}

export interface WipeContentResult {
  filesDeleted: number;
  freedBytes: number;
}

/**
 * Permanently delete ALL of a user's stored content while KEEPING their account: every file
 * (personal Drive, vaults, Trash, and the Shared Spaces they own), the folders, and the Shared
 * Spaces they own are removed, and their usedBytes is reset to 0. Their membership of spaces
 * owned by OTHER users is untouched. Used by the admin "empty a user's storage" action and by
 * the self-service account wipe.
 */
export async function wipeOwnerContent(ctx: AppContext, ownerId: string): Promise<WipeContentResult> {
  const files = await prisma.fileObject.findMany({
    where: { ownerId },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  const freed = await purgeFiles(ctx, ownerId, files); // blobs + versions + rows + quota
  // Drop the Shared Spaces this user owns (cascades their members and any leftover space folders),
  // then the personal folder trees.
  await prisma.sharedSpace.deleteMany({ where: { ownerId } });
  await prisma.folder.deleteMany({ where: { ownerId } });
  // Authoritative reset — the user now stores nothing.
  await prisma.user.update({ where: { id: ownerId }, data: { usedBytes: 0n } });
  return { filesDeleted: files.length, freedBytes: freed };
}

export async function emptyTrash(ctx: AppContext, ownerId: string): Promise<void> {
  const folders = await prisma.folder.findMany({
    where: { ownerId, spaceId: null, deletedAt: { not: null }, OR: [{ parentId: null }, { parent: { deletedAt: null } }] },
    select: { id: true },
  });
  for (const f of folders) await purgeFolder(ctx, ownerId, f.id);

  const files = await prisma.fileObject.findMany({
    where: { ownerId, spaceId: null, deletedAt: { not: null } },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  await purgeFiles(ctx, ownerId, files);
}

/** Maintenance: purge everything trashed before `cutoff`, across all users. */
export async function purgeExpiredTrash(ctx: AppContext, cutoff: Date): Promise<number> {
  // Folders first (cascade their files), then any remaining standalone trashed files.
  const folders = await prisma.folder.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, ownerId: true },
  });
  for (const f of folders) await purgeFolder(ctx, f.ownerId, f.id).catch(() => {});

  const files = await prisma.fileObject.findMany({
    where: { deletedAt: { lt: cutoff } },
    select: { id: true, ownerId: true, storageKey: true, sizeBytes: true },
  });
  const byOwner = new Map<string, typeof files>();
  for (const f of files) {
    const list = byOwner.get(f.ownerId) ?? [];
    list.push(f);
    byOwner.set(f.ownerId, list);
  }
  let purged = folders.length;
  for (const [ownerId, list] of byOwner) {
    await purgeFiles(ctx, ownerId, list).catch(() => {});
    purged += list.length;
  }
  return purged;
}

/** Purge one owner's items trashed before `cutoff`. */
async function purgeExpiredTrashForOwner(ctx: AppContext, ownerId: string, cutoff: Date): Promise<number> {
  const folders = await prisma.folder.findMany({
    where: { ownerId, spaceId: null, deletedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const f of folders) await purgeFolder(ctx, ownerId, f.id).catch(() => {});
  const files = await prisma.fileObject.findMany({
    where: { ownerId, spaceId: null, deletedAt: { lt: cutoff } },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  await purgeFiles(ctx, ownerId, files).catch(() => {});
  return folders.length + files.length;
}

/**
 * Maintenance: purge each user's Trash according to THAT user's chosen retention window
 * (User.trashRetentionDays; 0 = never auto-purge). Replaces a single instance-wide cutoff so
 * everyone controls how long their own deleted items linger.
 */
export async function purgeExpiredTrashPerUser(ctx: AppContext): Promise<number> {
  const users = await prisma.user.findMany({ select: { id: true, trashRetentionDays: true } });
  let purged = 0;
  for (const u of users) {
    const days = u.trashRetentionDays ?? 7;
    if (days <= 0) continue; // 0 = keep until manually emptied
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    purged += await purgeExpiredTrashForOwner(ctx, u.id, cutoff).catch(() => 0);
  }
  return purged;
}

// ── Trash listing ──────────────────────────────────────────────────────────--

export interface TrashEntry {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  sizeBytes: number | null;
  deletedAt: string;
}

/** List the Trash "roots": items trashed directly, not those hidden because a parent was. */
export async function listTrash(ownerId: string): Promise<TrashEntry[]> {
  const [folders, files] = await Promise.all([
    prisma.folder.findMany({
      where: { ownerId, spaceId: null, deletedAt: { not: null }, OR: [{ parentId: null }, { parent: { deletedAt: null } }] },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.fileObject.findMany({
      where: { ownerId, spaceId: null, deletedAt: { not: null }, OR: [{ folderId: null }, { folder: { deletedAt: null } }] },
      orderBy: { deletedAt: 'desc' },
    }),
  ]);

  const folderEntries: TrashEntry[] = folders.map((f) => ({
    kind: 'folder',
    id: f.id,
    name: f.name,
    sizeBytes: null,
    deletedAt: f.deletedAt!.toISOString(),
  }));
  const fileEntries: TrashEntry[] = files.map((f) => ({
    kind: 'file',
    id: f.id,
    // ZK files store an opaque placeholder name; surface a generic label.
    name: f.encMode === 'ZK' ? 'Fichier chiffré' : f.name,
    sizeBytes: Number(f.sizeBytes),
    deletedAt: f.deletedAt!.toISOString(),
  }));

  return [...folderEntries, ...fileEntries].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}
