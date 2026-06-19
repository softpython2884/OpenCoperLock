/**
 * Lightweight versioning for text-like files. When a file is re-uploaded under the same
 * name in the same folder, its previous content is retained as a `FileVersion` (no blob
 * copy — the old ciphertext blob simply becomes the version's). Only a bounded number of
 * versions are kept; older ones are pruned and their blobs/quota released.
 */
import type { FileObject } from '@prisma/client';
import { mimeKind } from '@opencoperlock/shared';
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';

const MAX_VERSIONS = 10;
const VERSIONABLE_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'ini', 'conf',
]);

/** Whether a file should be versioned, by MIME kind or a known text extension. */
export function isVersionable(name: string, mime: string): boolean {
  if (mimeKind(mime) === 'text') return true;
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return VERSIONABLE_EXTENSIONS.has(ext);
}

/** The most recent SERVER file with this name in this folder, or null. */
export function findVersionTarget(ownerId: string, folderId: string | null, name: string) {
  return prisma.fileObject.findFirst({
    where: { ownerId, folderId, name, encMode: 'SERVER' },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Snapshot `current`'s existing content as a version (reusing its blob), so the caller can
 * then overwrite the FileObject with new content. Returns nothing; the row is created.
 */
export async function snapshotVersion(current: FileObject): Promise<void> {
  if (!current.wrappedKey || !current.iv || !current.authTag) return; // not server-encrypted
  await prisma.fileVersion.create({
    data: {
      fileId: current.id,
      storageKey: current.storageKey,
      sizeBytes: current.sizeBytes,
      mimeType: current.mimeType,
      wrappedKey: current.wrappedKey,
      iv: current.iv,
      authTag: current.authTag,
      sha256: current.sha256,
    },
  });
}

/** Delete versions beyond MAX_VERSIONS (oldest first). Returns bytes freed. */
export async function pruneVersions(ctx: AppContext, fileId: string): Promise<number> {
  const versions = await prisma.fileVersion.findMany({
    where: { fileId },
    orderBy: { createdAt: 'desc' },
  });
  const excess = versions.slice(MAX_VERSIONS);
  let freed = 0;
  for (const v of excess) {
    await ctx.storage.delete(v.storageKey).catch(() => {});
    await prisma.fileVersion.delete({ where: { id: v.id } });
    freed += Number(v.sizeBytes);
  }
  return freed;
}

/** Total bytes held by a file's versions (for quota accounting on delete). */
export async function versionsBytes(fileId: string): Promise<number> {
  const agg = await prisma.fileVersion.aggregate({
    where: { fileId },
    _sum: { sizeBytes: true },
  });
  return Number(agg._sum.sizeBytes ?? 0n);
}
