/**
 * Share-link access control and presentation. Keeps the policy (expiry, download cap,
 * access mode) in one place so the recipient metadata endpoint and the download endpoint
 * enforce exactly the same rules.
 */
import type { FileObject, ShareLink } from '@prisma/client';
import { mimeKind, type ShareEntry } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { verifyPassword } from './password.js';

export function isExpired(share: ShareLink): boolean {
  return share.expiresAt !== null && share.expiresAt.getTime() < Date.now();
}

export function isExhausted(share: ShareLink): boolean {
  return share.maxDownloads !== null && share.downloadCount >= share.maxDownloads;
}

export interface AccessDecision {
  allowed: boolean;
  requiresCode?: boolean;
  requiresAuth?: boolean;
}

/**
 * Decide whether a recipient may access the share given an optional code and an optional
 * authenticated user. Does not consider expiry/exhaustion — callers check those first.
 */
export async function decideAccess(
  share: ShareLink,
  opts: { code?: string; userId?: string | null },
): Promise<AccessDecision> {
  switch (share.access) {
    case 'PUBLIC':
      return { allowed: true };
    case 'AUTHENTICATED':
      return opts.userId ? { allowed: true } : { allowed: false, requiresAuth: true };
    case 'CODE': {
      if (!opts.code) return { allowed: false, requiresCode: true };
      const ok = share.codeHash ? await verifyPassword(share.codeHash, opts.code) : false;
      return ok ? { allowed: true } : { allowed: false, requiresCode: true };
    }
    default:
      return { allowed: false };
  }
}

function toEntry(file: FileObject): ShareEntry {
  return {
    fileId: file.id,
    name: file.name,
    sizeBytes: Number(file.sizeBytes),
    mimeType: file.mimeType,
    kind: mimeKind(file.mimeType),
  };
}

/** The files a share exposes: a single file, or the SERVER files directly in a folder. */
export async function shareEntries(share: ShareLink): Promise<ShareEntry[]> {
  if (share.fileId) {
    const file = await prisma.fileObject.findUnique({ where: { id: share.fileId } });
    return file ? [toEntry(file)] : [];
  }
  if (share.folderId) {
    const files = await prisma.fileObject.findMany({
      where: { folderId: share.folderId, ownerId: share.ownerId, encMode: 'SERVER', deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return files.map(toEntry);
  }
  return [];
}

/** Look up the file a share download is allowed to serve, scoped to the share's target. */
export async function shareFile(share: ShareLink, fileId: string): Promise<FileObject | null> {
  if (share.fileId) {
    if (fileId !== share.fileId) return null;
    return prisma.fileObject.findUnique({ where: { id: share.fileId } });
  }
  if (share.folderId) {
    return prisma.fileObject.findFirst({
      where: { id: fileId, folderId: share.folderId, ownerId: share.ownerId, encMode: 'SERVER', deletedAt: null },
    });
  }
  return null;
}
