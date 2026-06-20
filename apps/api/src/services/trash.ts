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
      where: { parentId: ids[i], ownerId },
      select: { id: true },
    });
    ids.push(...children.map((c) => c.id));
  }
  return ids;
}

// ── Soft-delete ──────────────────────────────────────────────────────────────

export async function trashFile(ownerId: string, fileId: string): Promise<boolean> {
  const res = await prisma.fileObject.updateMany({
    where: { id: fileId, ownerId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return res.count > 0;
}

export async function trashFolder(ownerId: string, folderId: string): Promise<boolean> {
  const owned = await prisma.folder.findFirst({ where: { id: folderId, ownerId, deletedAt: null } });
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
  const file = await prisma.fileObject.findFirst({ where: { id: fileId, ownerId, deletedAt: { not: null } } });
  if (!file) return false;
  // If the file's folder is gone or still trashed, restore it to the account root.
  let folderId = file.folderId;
  if (folderId) {
    const parent = await prisma.folder.findFirst({ where: { id: folderId, ownerId } });
    if (!parent || parent.deletedAt) folderId = null;
  }
  await prisma.fileObject.update({ where: { id: fileId }, data: { deletedAt: null, folderId } });
  return true;
}

export async function restoreFolder(ownerId: string, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId, deletedAt: { not: null } } });
  if (!folder) return false;
  const ids = await subtreeFolderIds(ownerId, folderId);
  // If the parent is gone or still trashed, restore this folder to the root.
  let parentId = folder.parentId;
  if (parentId) {
    const parent = await prisma.folder.findFirst({ where: { id: parentId, ownerId } });
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
    where: { id: fileId, ownerId, deletedAt: { not: null } },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  if (!file) return false;
  await purgeFiles(ctx, ownerId, [file]);
  return true;
}

export async function purgeFolder(ctx: AppContext, ownerId: string, folderId: string): Promise<boolean> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId, deletedAt: { not: null } } });
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

export async function emptyTrash(ctx: AppContext, ownerId: string): Promise<void> {
  const folders = await prisma.folder.findMany({
    where: { ownerId, deletedAt: { not: null }, OR: [{ parentId: null }, { parent: { deletedAt: null } }] },
    select: { id: true },
  });
  for (const f of folders) await purgeFolder(ctx, ownerId, f.id);

  const files = await prisma.fileObject.findMany({
    where: { ownerId, deletedAt: { not: null } },
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
      where: { ownerId, deletedAt: { not: null }, OR: [{ parentId: null }, { parent: { deletedAt: null } }] },
      orderBy: { deletedAt: 'desc' },
    }),
    prisma.fileObject.findMany({
      where: { ownerId, deletedAt: { not: null }, OR: [{ folderId: null }, { folder: { deletedAt: null } }] },
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
