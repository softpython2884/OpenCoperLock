/**
 * Map Prisma rows to the public DTOs from `@opencoperlock/shared`. Centralising this
 * guarantees secrets (password hashes, wrapped keys, CSRF secrets) never leak into a
 * response by accident — only the fields listed here are ever serialised.
 */
import type {
  ApiToken,
  FileObject,
  Folder,
  QuickUploadCode,
  RemoteUploadJob,
  ShareLink,
  User,
  Webhook,
} from '@prisma/client';
import type {
  PublicApiToken,
  PublicFile,
  PublicFolder,
  PublicQuickCode,
  PublicRemoteJob,
  PublicShare,
  PublicUser,
  PublicWebhook,
} from '@opencoperlock/shared';

export function toPublicWebhook(w: Webhook): PublicWebhook {
  return {
    id: w.id,
    url: w.url,
    hasSecret: w.secret !== null && w.secret.length > 0,
    folderId: w.folderId,
    active: w.active,
    lastStatus: w.lastStatus,
    lastError: w.lastError,
    createdAt: w.createdAt.toISOString(),
  };
}

export function toPublicApiToken(t: ApiToken): PublicApiToken {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scopes: t.scopes ? t.scopes.split(',').filter(Boolean) : [],
    folderId: t.folderId,
    expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
  };
}

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
    isPublic: f.isPublic,
    zkSalt: f.zkSalt,
    zkVerifier: f.zkVerifier,
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
    publicSlug: f.publicSlug,
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

export function toPublicShare(s: ShareLink, targetName: string): PublicShare {
  return {
    id: s.id,
    token: s.token,
    fileId: s.fileId,
    folderId: s.folderId,
    targetName,
    viewType: s.viewType,
    access: s.access,
    allowDownload: s.allowDownload,
    expiresAt: s.expiresAt ? s.expiresAt.toISOString() : null,
    maxDownloads: s.maxDownloads,
    downloadCount: s.downloadCount,
    createdAt: s.createdAt.toISOString(),
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
