/**
 * Server-side cryptography helpers (Node `crypto`).
 *
 * This is the heart of the *server-side* encryption-at-rest leg of the hybrid model:
 * an envelope scheme where every file gets a fresh random Data Encryption Key (DEK),
 * the file bytes are sealed with AES-256-GCM, and the DEK itself is wrapped with the
 * deployment-wide Master Key (KEK) before being stored next to the file metadata.
 *
 * The Zero-Knowledge leg never touches this module — those keys are derived and used
 * in the browser, and the server only ever sees opaque ciphertext.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';
import { CRYPTO } from './constants.js';

/** Decode and validate the deployment Master Key from its base64 env value. */
export function loadMasterKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== CRYPTO.keyBytes) {
    throw new Error(
      `MASTER_KEY must decode to ${CRYPTO.keyBytes} bytes (got ${key.length}). ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

/** Generate a fresh per-file Data Encryption Key. */
export function generateDataKey(): Buffer {
  return randomBytes(CRYPTO.keyBytes);
}

/**
 * Wrap (encrypt) a DEK with the Master Key. Output layout (base64):
 *   [12-byte IV][16-byte GCM tag][ciphertext]
 */
export function wrapKey(dek: Buffer, masterKey: Buffer): string {
  const iv = randomBytes(CRYPTO.ivBytes);
  const cipher = createCipheriv(CRYPTO.algorithm, masterKey, iv) as CipherGCM;
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Reverse of {@link wrapKey}. Throws if the Master Key is wrong or data is tampered. */
export function unwrapKey(wrapped: string, masterKey: Buffer): Buffer {
  const buf = Buffer.from(wrapped, 'base64');
  const iv = buf.subarray(0, CRYPTO.ivBytes);
  const tag = buf.subarray(CRYPTO.ivBytes, CRYPTO.ivBytes + CRYPTO.authTagBytes);
  const ciphertext = buf.subarray(CRYPTO.ivBytes + CRYPTO.authTagBytes);
  const decipher = createDecipheriv(CRYPTO.algorithm, masterKey, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Create an AES-256-GCM cipher for streaming a file's bytes to storage.
 * Returns the random IV (store it) and the cipher; after `final()`, read
 * `cipher.getAuthTag()` and persist it so the file can be decrypted later.
 */
export function createFileCipher(dek: Buffer): { iv: Buffer; cipher: CipherGCM } {
  const iv = randomBytes(CRYPTO.ivBytes);
  const cipher = createCipheriv(CRYPTO.algorithm, dek, iv) as CipherGCM;
  return { iv, cipher };
}

/** Create the matching decipher for {@link createFileCipher}. */
export function createFileDecipher(dek: Buffer, iv: Buffer, authTag: Buffer): DecipherGCM {
  const decipher = createDecipheriv(CRYPTO.algorithm, dek, iv) as DecipherGCM;
  decipher.setAuthTag(authTag);
  return decipher;
}

/** Streaming SHA-256 hasher convenience (hex digest). */
export function createSha256() {
  return createHash('sha256');
}

/** Hash a buffer to a hex SHA-256 digest. */
export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Sign a payload with HMAC-SHA256, returning a base64url digest. */
export function hmacSign(payload: string, secret: Buffer | string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time string comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Generate a URL-safe random token (default 32 bytes -> 43 base64url chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Generate a short, human-typable Quick-Upload code (uppercase, no ambiguous chars).
 * Default 10 chars from a 32-symbol alphabet ≈ 50 bits of entropy.
 */
export function randomCode(length = 10): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[buf[i]! % alphabet.length];
  }
  return out;
}
