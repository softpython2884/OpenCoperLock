/**
 * DTO shapes returned by the API. These are the *public* projections — they
 * never include secrets such as wrapped keys, password hashes, or CSRF secrets.
 */
import type {
  AvStatus,
  EncMode,
  JobStatus,
  Role,
  ShareAccess,
  ShareViewType,
} from './constants.js';

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
  /** Per-vault PBKDF2 salt for ZK folders (null for normal folders / legacy vaults). */
  zkSalt: string | null;
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

/** Owner's view of a share link (management list). */
export interface PublicShare {
  id: string;
  token: string;
  fileId: string | null;
  folderId: string | null;
  targetName: string;
  viewType: ShareViewType;
  access: ShareAccess;
  allowDownload: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  createdAt: string;
}

/** What a recipient is allowed to know about a share before/while opening it. */
export type ShareItemKind = 'image' | 'text' | 'pdf' | 'audio' | 'video' | 'other';

export interface ShareEntry {
  fileId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: ShareItemKind;
}

export interface PublicShareView {
  token: string;
  viewType: ShareViewType;
  access: ShareAccess;
  allowDownload: boolean;
  /** True when the link points at a folder (entries list) rather than a single file. */
  isFolder: boolean;
  /** Present only once access is granted. */
  file?: ShareEntry;
  entries?: ShareEntry[];
  /** Signals for the recipient UI. */
  requiresCode?: boolean;
  requiresAuth?: boolean;
  expired?: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
}
