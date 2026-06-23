/**
 * Zod schemas shared across the API (request validation) and the web client
 * (form validation + typed responses). Keeping them here guarantees the two
 * sides never drift.
 */
import { z } from 'zod';
import { ENC_MODES, ROLES, SHARE_ACCESS_MODES, SHARE_VIEW_TYPES, SPACE_ROLES } from './constants.js';

// ── Primitives ───────────────────────────────────────────────────────────────

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/**
 * Password policy: long enough to matter, capped to avoid argon2 DoS via huge inputs.
 */
export const passwordSchema = z.string().min(12, 'Password must be at least 12 characters').max(256);

export const cuidSchema = z.string().min(1).max(64);

// ── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  // Optional second factor: a 6-digit TOTP code or a recovery code.
  totp: z.string().min(1).max(64).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ── Two-factor ───────────────────────────────────────────────────────────────

export const totpTokenSchema = z.object({
  token: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const passwordConfirmSchema = z.object({
  password: z.string().min(1).max(256),
});

// ── Folders ──────────────────────────────────────────────────────────────────

export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  // Forbid path separators and the special `.`/`..` names to keep storage safe.
  .refine((name) => !/[/\\]/.test(name) && name !== '.' && name !== '..', {
    message: 'Folder name contains invalid characters',
  })
  // Reject ASCII control characters without using a control-char regex literal.
  .refine((name) => ![...name].some((ch) => ch.charCodeAt(0) < 0x20), {
    message: 'Folder name contains control characters',
  });

export const createFolderSchema = z.object({
  name: folderNameSchema,
  parentId: cuidSchema.nullable().optional(),
  isZeroKnowledge: z.boolean().optional().default(false),
  // Client-generated per-vault salt (hex) for a new ZK vault; the server falls back to its
  // own random salt if omitted. Ignored for normal folders.
  zkSalt: z.string().min(8).max(128).optional(),
  // Opaque passphrase verifier (iv.ciphertext) for a new ZK vault; ignored for normal folders.
  zkVerifier: z.string().max(1024).optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

/** Rename and/or move a folder. At least one field should be present. */
export const updateFolderSchema = z
  .object({
    name: folderNameSchema.optional(),
    parentId: cuidSchema.nullable().optional(), // null = move to root
  })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, {
    message: 'Provide a new name and/or parent',
  });
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

/** A filename may contain spaces/dots but not path separators or control characters. */
export const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !/[/\\]/.test(name) && name !== '.' && name !== '..', {
    message: 'File name contains invalid characters',
  })
  .refine((name) => ![...name].some((ch) => ch.charCodeAt(0) < 0x20), {
    message: 'File name contains control characters',
  });

/** Rename and/or move a file. */
export const updateFileSchema = z
  .object({
    name: fileNameSchema.optional(),
    folderId: cuidSchema.nullable().optional(), // null = move to root
  })
  .refine((v) => v.name !== undefined || v.folderId !== undefined, {
    message: 'Provide a new name and/or folder',
  });
export type UpdateFileInput = z.infer<typeof updateFileSchema>;

// ── Remote-Upload ────────────────────────────────────────────────────────────

export const remoteUploadSchema = z.object({
  // Only http(s); deeper SSRF checks happen server-side at fetch time.
  sourceUrl: z.string().url().max(2048).startsWith('http'),
  folderId: cuidSchema.nullable().optional(),
});
export type RemoteUploadInput = z.infer<typeof remoteUploadSchema>;

// ── Quick-Upload codes (admin) ───────────────────────────────────────────────

export const createQuickCodeSchema = z.object({
  targetFolderId: cuidSchema.nullable().optional(),
  // Optional custom, memorable code (letters/digits/dashes). Blank => a random code is
  // generated. Normalised to uppercase so it's case-insensitive to type.
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(4)
    .max(32)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Use letters, digits and dashes only')
    .optional(),
  // null/undefined => no per-upload size limit beyond the user's quota.
  maxBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().positive().max(100000).nullable().optional(),
  password: z.string().min(4).max(256).nullable().optional(),
});
export type CreateQuickCodeInput = z.infer<typeof createQuickCodeSchema>;

/** Create a personal API token. `read` = list/download, `write` = upload/create folders. */
export const apiScopes = ['read', 'write'] as const;
export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(apiScopes)).min(1),
  // Optional: confine the token to a single folder (and its subtree).
  folderId: cuidSchema.nullable().optional(),
  // Optional lifetime; omit for a non-expiring token.
  expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

/** Register an outgoing webhook fired when a file lands in storage. */
export const createWebhookSchema = z.object({
  url: z.string().url().max(2000),
  // Optional HMAC-SHA256 signing secret.
  secret: z.string().min(8).max(200).optional(),
  // Optional: only fire for files landing in this folder.
  folderId: cuidSchema.nullable().optional(),
});
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;

/** Body sent by an anonymous guest when redeeming a Quick-Upload code. */
export const quickUploadRedeemSchema = z.object({
  password: z.string().max(256).optional(),
});

// ── Admin: users & settings ──────────────────────────────────────────────────

export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLES).default('USER'),
  quotaBytes: z.number().int().nonnegative().nullable().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  quotaBytes: z.number().int().nonnegative().nullable().optional(),
  disabled: z.boolean().optional(),
  password: passwordSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const updateSettingsSchema = z.object({
  // 0 = unlimited.
  globalStorageCapBytes: z.number().int().nonnegative().optional(),
  // Empty string clears the stored key (reverting to the .env value, if any).
  virustotalApiKey: z.string().max(200).optional(),
  // Periodically check GitHub and apply a newer build automatically (needs self-update enabled).
  autoUpdateEnabled: z.boolean().optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// ── Share links ──────────────────────────────────────────────────────────────

/**
 * Create a share for one file or one folder (exactly one of fileId/folderId). Zero-
 * knowledge targets cannot be shared server-side and are rejected by the API.
 */
export const createShareSchema = z
  .object({
    fileId: cuidSchema.optional(),
    folderId: cuidSchema.optional(),
    viewType: z.enum(SHARE_VIEW_TYPES).default('PAGE'),
    accessMode: z.enum(SHARE_ACCESS_MODES).default('PUBLIC'),
    // Required when accessMode is CODE; ignored otherwise.
    code: z.string().min(4).max(256).optional(),
    expiresAt: z.coerce.date().nullable().optional(),
    maxDownloads: z.number().int().positive().max(1_000_000).nullable().optional(),
    allowDownload: z.boolean().optional().default(true),
  })
  .refine((v) => (v.fileId ? !v.folderId : !!v.folderId), {
    message: 'Provide exactly one of fileId or folderId',
  })
  .refine((v) => v.accessMode !== 'CODE' || (v.code && v.code.length >= 4), {
    message: 'A code of at least 4 characters is required for code-protected shares',
  });
export type CreateShareInput = z.infer<typeof createShareSchema>;

// ── Shared Spaces ────────────────────────────────────────────────────────────

/** A space name follows the same rules as a folder name (no separators / control chars). */
export const createSpaceSchema = z.object({
  name: folderNameSchema,
});
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

export const updateSpaceSchema = z.object({
  name: folderNameSchema,
});
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;

/** Add an existing instance user to a space, by email, with a role. */
export const addSpaceMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(SPACE_ROLES).default('VIEWER'),
});
export type AddSpaceMemberInput = z.infer<typeof addSpaceMemberSchema>;

export const updateSpaceMemberSchema = z.object({
  role: z.enum(SPACE_ROLES),
});
export type UpdateSpaceMemberInput = z.infer<typeof updateSpaceMemberSchema>;

/**
 * What happens to a space's content when its owner deletes it:
 *  - 'delete'   permanently removes the space and everything in it (frees the owner's quota),
 *  - 'transfer' hands the space (and its storage cost) to the earliest-joined member.
 */
export const DELETE_SPACE_MODES = ['delete', 'transfer'] as const;
export const deleteSpaceModeSchema = z.enum(DELETE_SPACE_MODES);
export type DeleteSpaceMode = (typeof DELETE_SPACE_MODES)[number];

// ── Zero-Knowledge vault ─────────────────────────────────────────────────────

/**
 * Metadata accompanying a client-encrypted (Zero-Knowledge) upload. The server
 * stores these opaque values verbatim and can never derive the plaintext key.
 */
export const zkFileMetaSchema = z.object({
  folderId: cuidSchema,
  // Original filename, itself encrypted client-side and base64-encoded.
  encryptedName: z.string().min(1).max(8192),
  // base64 IV used for the file-content encryption.
  iv: z.string().min(1).max(128),
  // base64 wrapped data key (wrapped by the user's passphrase-derived key).
  wrappedKey: z.string().min(1).max(8192),
  // Plaintext size is intentionally NOT required; ciphertext size is measured server-side.
  encMode: z.literal(ENC_MODES[1]), // 'ZK'
});
export type ZkFileMeta = z.infer<typeof zkFileMetaSchema>;
