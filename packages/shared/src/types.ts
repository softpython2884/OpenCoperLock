/**
 * DTO shapes returned by the API. These are the *public* projections — they
 * never include secrets such as wrapped keys, password hashes, or CSRF secrets.
 */
import type { AvStatus, EncMode, JobStatus, Role } from './constants.js';

export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  quotaBytes: number | null;
  usedBytes: number;
  disabled: boolean;
  createdAt: string;
}

export interface PublicFolder {
  id: string;
  name: string;
  parentId: string | null;
  isZeroKnowledge: boolean;
  createdAt: string;
}

export interface PublicFile {
  id: string;
  name: string;
  folderId: string | null;
  sizeBytes: number;
  mimeType: string;
  encMode: EncMode;
  avStatus: AvStatus;
  sha256: string | null;
  createdAt: string;
}

export interface PublicQuickCode {
  id: string;
  code: string;
  targetFolderId: string | null;
  maxBytes: number | null;
  expiresAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  createdAt: string;
}

export interface PublicRemoteJob {
  id: string;
  sourceUrl: string;
  status: JobStatus;
  sizeBytes: number | null;
  error: string | null;
  fileId: string | null;
  createdAt: string;
}

export interface StorageStats {
  globalUsedBytes: number;
  globalCapBytes: number;
}

export interface ApiError {
  error: string;
  code?: string;
}
