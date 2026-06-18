import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { loadMasterKey } from '@opencoperlock/shared';
import type { AppContext } from '../context.js';
import type { StorageDriver } from '../storage/types.js';
import { ClamAvScanner } from '../security/clamav.js';
import { VirusTotalClient } from '../security/virustotal.js';
import { FileTooLargeError, ingestPlaintext } from './ingest.js';
import { decryptServerFile } from './download.js';

/** In-memory storage driver for tests. */
class MemoryStorage implements StorageDriver {
  blobs = new Map<string, Buffer>();
  async write(key: string, data: Readable) {
    const chunks: Buffer[] = [];
    for await (const c of data) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    this.blobs.set(key, buf);
    return { bytesWritten: buf.length };
  }
  createReadStream(key: string) {
    return Readable.from(this.blobs.get(key) ?? Buffer.alloc(0));
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
  async exists(key: string) {
    return this.blobs.has(key);
  }
  async quarantine() {}
}

function makeCtx(storage: StorageDriver): AppContext {
  return {
    // Only the fields ingest/download touch are needed.
    env: { masterKey: loadMasterKey(Buffer.alloc(32, 9).toString('base64')) } as AppContext['env'],
    storage,
    scanner: new ClamAvScanner({ enabled: false, host: '', port: 0 }),
    virustotal: new VirusTotalClient(''),
  };
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

describe('ingest + download round-trip', () => {
  it('encrypts to storage and decrypts back to the original bytes', async () => {
    const storage = new MemoryStorage();
    const ctx = makeCtx(storage);
    const plaintext = Buffer.from('OpenCoperLock secret payload éàü '.repeat(500));

    const result = await ingestPlaintext(ctx, Readable.from(plaintext), {
      maxBytes: 10_000_000,
      storageKey: 'ab/cd/deadbeef',
    });

    expect(result.sizeBytes).toBe(plaintext.length);
    expect(result.avStatus).toBe('SKIPPED'); // scanner disabled
    // The blob on disk must NOT equal the plaintext.
    expect(storage.blobs.get('ab/cd/deadbeef')!.equals(plaintext)).toBe(false);

    const decrypted = await collect(decryptServerFile(ctx, result));
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('aborts when the stream exceeds maxBytes', async () => {
    const storage = new MemoryStorage();
    const ctx = makeCtx(storage);
    const big = Readable.from(Buffer.alloc(5000));
    await expect(
      ingestPlaintext(ctx, big, { maxBytes: 1000, storageKey: 'ab/cd/toolarge' }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });
});
