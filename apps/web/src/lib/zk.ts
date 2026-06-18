/**
 * Zero-Knowledge client-side cryptography using the Web Crypto API.
 *
 * The server NEVER sees the passphrase, the derived key, or the per-file data key
 * in plaintext. For each vault we:
 *   - derive a vault key from the passphrase with PBKDF2-SHA256 (high iteration count),
 *   - generate a random per-file AES-GCM data key,
 *   - encrypt the file bytes and the filename with that data key,
 *   - wrap (encrypt) the data key with the vault key.
 *
 * The server stores only ciphertext + the wrapped key + IVs. Decryption is the exact
 * inverse, performed entirely in the browser.
 */

const PBKDF2_ITERATIONS = 210_000; // OWASP-recommended floor for PBKDF2-SHA256
const SALT = 'opencoperlock.zk.v1'; // domain-separation salt (per-vault salt is future work)

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
// Allocate a fresh ArrayBuffer-backed view so the result satisfies the DOM
// `BufferSource` type (which, since TS 5.7, excludes SharedArrayBuffer-backed views).
function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const view = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) view[i] = bin.charCodeAt(i);
  return view;
}

/** Derive a non-extractable AES-GCM vault key from the user's passphrase. */
export async function deriveVaultKey(passphrase: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  );
}

export interface EncryptedUpload {
  blob: Blob;
  encryptedName: string;
  iv: string;
  wrappedKey: string;
}

/** Encrypt a file for upload to a vault. Returns ciphertext blob + metadata strings. */
export async function encryptFile(vaultKey: CryptoKey, file: File): Promise<EncryptedUpload> {
  const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);

  // Encrypt the file content.
  const contentIv = crypto.getRandomValues(new Uint8Array(12));
  const content = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: contentIv },
    dataKey,
    await file.arrayBuffer(),
  );

  // Encrypt the filename with its own IV (prepended so it travels in one field).
  const nameIv = crypto.getRandomValues(new Uint8Array(12));
  const nameCt = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nameIv },
    dataKey,
    enc.encode(file.name),
  );
  const encryptedName = `${toB64(nameIv.buffer)}.${toB64(nameCt)}`;

  // Wrap the data key with the vault key.
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('raw', dataKey, vaultKey, {
    name: 'AES-GCM',
    iv: wrapIv,
  });
  const wrappedKey = `${toB64(wrapIv.buffer)}.${toB64(wrapped)}`;

  return {
    blob: new Blob([content], { type: 'application/octet-stream' }),
    encryptedName,
    iv: toB64(contentIv.buffer),
    wrappedKey,
  };
}

/** Recover the per-file data key from its wrapped form. */
async function unwrapDataKey(vaultKey: CryptoKey, wrappedKey: string): Promise<CryptoKey> {
  const [ivB64, ctB64] = wrappedKey.split('.');
  return crypto.subtle.unwrapKey(
    'raw',
    fromB64(ctB64!),
    vaultKey,
    { name: 'AES-GCM', iv: fromB64(ivB64!) },
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/** Decrypt a vault filename. Returns a placeholder if the passphrase is wrong. */
export async function decryptName(
  vaultKey: CryptoKey,
  encryptedName: string,
  wrappedKey: string,
): Promise<string> {
  try {
    const dataKey = await unwrapDataKey(vaultKey, wrappedKey);
    const [ivB64, ctB64] = encryptedName.split('.');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(ivB64!) },
      dataKey,
      fromB64(ctB64!),
    );
    return dec.decode(plain);
  } catch {
    return '🔒 (wrong passphrase?)';
  }
}

/** Decrypt downloaded vault ciphertext back into a Blob for saving. */
export async function decryptBlob(
  vaultKey: CryptoKey,
  ciphertext: ArrayBuffer,
  iv: string,
  wrappedKey: string,
): Promise<Blob> {
  const dataKey = await unwrapDataKey(vaultKey, wrappedKey);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) },
    dataKey,
    ciphertext,
  );
  return new Blob([plain]);
}
