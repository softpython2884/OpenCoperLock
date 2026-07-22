/**
 * Core server-side ingestion pipeline, shared by the Drive upload, Quick-Upload,
 * and Remote-Upload paths. Given a plaintext stream it:
 *
 *   1. spools to a temp file while measuring size + SHA-256 (and enforcing a byte cap),
 *   2. antivirus-scans the plaintext,
 *   3. on a clean/skip result, encrypts the bytes to storage with a fresh per-file DEK,
 *   4. wraps that DEK with the deployment MASTER_KEY.
 *
 * Returns everything the caller needs to persist a `FileObject` row. The temp file
 * is always cleaned up.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  createFileCipher,
  createSha256,
  generateDataKey,
  wrapKey,
  type AvStatus,
} from '@opencoperlock/shared';
import type { AppContext } from '../context.js';

export class FileTooLargeError extends Error {
  constructor() {
    super('Upload exceeds the allowed size');
    this.name = 'FileTooLargeError';
  }
}

export class InfectedFileError extends Error {
  constructor(public readonly signature: string) {
    super(`File rejected by antivirus: ${signature}`);
    this.name = 'InfectedFileError';
  }
}

export interface IngestResult {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  wrappedKey: string;
  iv: string;
  authTag: string;
  avStatus: AvStatus;
}

/** Spool the plaintext to a temp file, measuring size + hash and enforcing maxBytes. */
async function spool(
  source: Readable,
  maxBytes: number,
): Promise<{ path: string; cleanup: () => Promise<void>; sizeBytes: number; sha256: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ocl-'));
  const path = join(dir, 'plain');
  const cleanup = () => rm(dir, { recursive: true, force: true });

  const hash = createSha256();
  let sizeBytes = 0;
  source.on('data', (chunk: Buffer) => {
    sizeBytes += chunk.length;
    hash.update(chunk);
    if (sizeBytes > maxBytes) {
      source.destroy(new FileTooLargeError());
    }
  });

  try {
    await pipeline(source, createWriteStream(path));
  } catch (err) {
    await cleanup();
    throw err;
  }
  return { path, cleanup, sizeBytes, sha256: hash.digest('hex') };
}

export async function ingestPlaintext(
  ctx: AppContext,
  source: Readable,
  opts: { maxBytes: number; storageKey: string },
): Promise<IngestResult> {
  const { path, cleanup, sizeBytes, sha256 } = await spool(source, opts.maxBytes);

  try {
    // 1. Antivirus scan on the spooled plaintext.
    const scan = await ctx.scanner.scanStream(createReadStream(path));
    if (scan.status === 'INFECTED') {
      throw new InfectedFileError(scan.signature ?? 'unknown');
    }

    // 2. Encrypt plaintext -> storage with a fresh DEK.
    const dek = generateDataKey();
    const { iv, cipher } = createFileCipher(dek);
    const ciphertext = createReadStream(path).pipe(cipher);
    await ctx.storage.write(opts.storageKey, ciphertext);
    const authTag = cipher.getAuthTag();

    return {
      storageKey: opts.storageKey,
      sizeBytes,
      sha256,
      wrappedKey: wrapKey(dek, ctx.env.masterKey),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      avStatus: scan.status,
    };
  } finally {
    await cleanup();
  }
}

export interface PublicIngestResult {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  avStatus: AvStatus;
}

/**
 * Ingest for a Public/Open space: spool + antivirus-scan, then store the bytes as PLAINTEXT (no
 * encryption). This is deliberate — public media must be range-servable and load fast, which
 * AES-GCM ciphertext (non-seekable, verify-on-final) can't do. Still scanned so a public URL
 * can't be turned into malware hosting.
 */
export async function ingestPublic(
  ctx: AppContext,
  source: Readable,
  opts: { maxBytes: number; storageKey: string },
): Promise<PublicIngestResult> {
  const { path, cleanup, sizeBytes, sha256 } = await spool(source, opts.maxBytes);
  try {
    const scan = await ctx.scanner.scanStream(createReadStream(path));
    if (scan.status === 'INFECTED') {
      throw new InfectedFileError(scan.signature ?? 'unknown');
    }
    await ctx.storage.write(opts.storageKey, createReadStream(path));
    return { storageKey: opts.storageKey, sizeBytes, sha256, avStatus: scan.status };
  } finally {
    await cleanup();
  }
}
