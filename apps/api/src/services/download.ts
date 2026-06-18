/**
 * Decrypting read path for SERVER-mode files: unwrap the per-file DEK with the
 * MASTER_KEY and stream the storage blob back through an AES-GCM decipher.
 *
 * Note: AES-GCM verifies the auth tag only after the final block, so a truncated or
 * tampered blob surfaces as a stream error at the end rather than up front. That is an
 * accepted property of streaming AEAD; storage integrity is the first line of defence.
 */
import type { Readable } from 'node:stream';
import { createFileDecipher, unwrapKey } from '@opencoperlock/shared';
import type { AppContext } from '../context.js';

interface ServerEncryptedFile {
  storageKey: string;
  wrappedKey: string | null;
  iv: string | null;
  authTag: string | null;
}

export function decryptServerFile(ctx: AppContext, file: ServerEncryptedFile): Readable {
  if (!file.wrappedKey || !file.iv || !file.authTag) {
    throw new Error('Missing crypto material for SERVER-mode file');
  }
  const dek = unwrapKey(file.wrappedKey, ctx.env.masterKey);
  const decipher = createFileDecipher(
    dek,
    Buffer.from(file.iv, 'base64'),
    Buffer.from(file.authTag, 'base64'),
  );
  return ctx.storage.createReadStream(file.storageKey).pipe(decipher);
}
