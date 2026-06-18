/**
 * Cross-cutting constants shared between the API and the web client.
 */

/** User roles. Mirrors the Prisma `Role` enum. */
export const ROLES = ['ADMIN', 'USER'] as const;
export type Role = (typeof ROLES)[number];

/** How a file's bytes are protected at rest. Mirrors the Prisma `EncMode` enum. */
export const ENC_MODES = ['SERVER', 'ZK'] as const;
export type EncMode = (typeof ENC_MODES)[number];

/** Antivirus scan outcome for a stored file. Mirrors the Prisma `AvStatus` enum. */
export const AV_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED'] as const;
export type AvStatus = (typeof AV_STATUSES)[number];

/** Lifecycle of a server-side Remote-Upload job. Mirrors the Prisma `JobStatus` enum. */
export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Name of the session cookie. */
export const SESSION_COOKIE = 'ocl_session';

/** Header carrying the CSRF token on mutating requests. */
export const CSRF_HEADER = 'x-ocl-csrf';

/** Crypto parameters for server-side envelope encryption. */
export const CRYPTO = {
  /** AES-256-GCM. */
  algorithm: 'aes-256-gcm',
  keyBytes: 32,
  ivBytes: 12,
  authTagBytes: 16,
} as const;
