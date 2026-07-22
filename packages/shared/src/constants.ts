/**
 * Cross-cutting constants shared between the API and the web client.
 */

/** User roles. Mirrors the Prisma `Role` enum. */
export const ROLES = ['ADMIN', 'USER'] as const;
export type Role = (typeof ROLES)[number];

/** How a file's bytes are protected at rest. Mirrors the Prisma `EncMode` enum. */
export const ENC_MODES = ['SERVER', 'ZK', 'PUBLIC'] as const;
export type EncMode = (typeof ENC_MODES)[number];

/** Antivirus scan outcome for a stored file. Mirrors the Prisma `AvStatus` enum. */
export const AV_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED'] as const;
export type AvStatus = (typeof AV_STATUSES)[number];

/** Lifecycle of a server-side Remote-Upload job. Mirrors the Prisma `JobStatus` enum. */
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** How a share link presents its target. RAW = direct file; PAGE = a landing/preview page. */
export const SHARE_VIEW_TYPES = ['RAW', 'PAGE'] as const;
export type ShareViewType = (typeof SHARE_VIEW_TYPES)[number];

/**
 * Who may open a share, mirroring the Prisma `ShareAccess` enum:
 *  - PUBLIC        anyone with the link
 *  - CODE          anyone with the link who also enters the code/password
 *  - AUTHENTICATED only signed-in users of this instance
 */
export const SHARE_ACCESS_MODES = ['PUBLIC', 'CODE', 'AUTHENTICATED'] as const;
export type ShareAccess = (typeof SHARE_ACCESS_MODES)[number];

/**
 * Role of a member inside a Shared Space (mirrors the Prisma `SpaceRole` enum):
 *  - EDITOR can upload, rename, move and delete content,
 *  - VIEWER can only browse and download.
 * The space OWNER is implicit (not a member row) and always has full control.
 */
export const SPACE_ROLES = ['EDITOR', 'VIEWER'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

/** A caller's effective role on a space: the two member roles plus the implicit OWNER. */
export const SPACE_ACCESS_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type SpaceAccessRole = (typeof SPACE_ACCESS_ROLES)[number];

/** Name of the session cookie. */
export const SESSION_COOKIE = 'ocl_session';

/** Header carrying the CSRF token on mutating requests. */
export const CSRF_HEADER = 'x-ocl-csrf';

/**
 * Well-known names of the per-user system folders that collect files which would otherwise
 * have no home: Quick-Upload code drops and Remote-Upload fetches. Each is created on demand
 * (and eagerly for Fast-Upload at account creation) so the owner always knows where to look.
 */
export const FAST_UPLOAD_FOLDER_NAME = 'Fast-Upload';
export const REMOTE_UPLOAD_FOLDER_NAME = 'Remote-Upload';

/** Crypto parameters for server-side envelope encryption. */
export const CRYPTO = {
  /** AES-256-GCM. */
  algorithm: 'aes-256-gcm',
  keyBytes: 32,
  ivBytes: 12,
  authTagBytes: 16,
} as const;
