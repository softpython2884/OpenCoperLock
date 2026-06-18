/**
 * Map Prisma rows to the public DTOs from `@opencoperlock/shared`. Centralising this
 * guarantees secrets (password hashes, wrapped keys, CSRF secrets) never leak into a
 * response by accident — only the fields listed here are ever serialised.
 */
import type {
  FileObject,
  Folder,
  QuickUploadCode,
  RemoteUploadJob,
  User,
} from '@prisma/client';
import type {
  PublicFile,
  PublicFolder,
  PublicQuickCode,
  PublicRemoteJob,
  PublicUser,
} from '@opencoperlock/shared';

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    quotaBytes: u.quotaBytes === null ? null : Number(u.quotaBytes),
    usedBytes: Number(u.usedBytes),
    disabled: u.disabled,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toPublicFolder(f: Folder): PublicFolder {
  return {
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    isZeroKnowledge: f.isZeroKnowledge,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toPublicFile(f: FileObject): PublicFile {
  return {
    id: f.id,
    // For ZK files the real name is the client-encrypted blob; expose that so the
    // browser can decrypt it. SERVER files expose their plaintext name.
    name: f.encMode === 'ZK' ? (f.zkEncryptedName ?? '') : f.name,
    folderId: f.folderId,
    sizeBytes: Number(f.sizeBytes),
    mimeType: f.mimeType,
    encMode: f.encMode,
    avStatus: f.avStatus,
    sha256: f.sha256,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toPublicQuickCode(c: QuickUploadCode): PublicQuickCode {
  return {
    id: c.id,
    code: c.code,
    targetFolderId: c.targetFolderId,
    maxBytes: c.maxBytes === null ? null : Number(c.maxBytes),
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    usageLimit: c.usageLimit,
    usageCount: c.usageCount,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toPublicRemoteJob(j: RemoteUploadJob): PublicRemoteJob {
  return {
    id: j.id,
    sourceUrl: j.sourceUrl,
    status: j.status,
    sizeBytes: j.sizeBytes === null ? null : Number(j.sizeBytes),
    error: j.error,
    fileId: j.fileId,
    createdAt: j.createdAt.toISOString(),
  };
}
