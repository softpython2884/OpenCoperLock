import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './types.js';

/** Allow only the sharded keys we generate: `ab/cd/<cuid>`. Blocks path traversal. */
const KEY_RE = /^[a-z0-9]{2}\/[a-z0-9]{2}\/[a-z0-9]+$/;

export class LocalStorageDriver implements StorageDriver {
  constructor(
    private readonly basePath: string,
    private readonly quarantinePath: string,
  ) {}

  /** Resolve a key to an absolute path, refusing anything that escapes basePath. */
  private resolveKey(base: string, key: string): string {
    if (!KEY_RE.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    const full = resolve(base, key);
    const root = resolve(base);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error('Resolved storage path escapes the storage root');
    }
    return full;
  }

  async write(key: string, data: Readable): Promise<{ bytesWritten: number }> {
    const path = this.resolveKey(this.basePath, key);
    await mkdir(dirname(path), { recursive: true });
    let bytesWritten = 0;
    data.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });
    await pipeline(data, createWriteStream(path, { mode: 0o600 }));
    return { bytesWritten };
  }

  createReadStream(key: string, range?: { start?: number; end?: number }): Readable {
    const path = this.resolveKey(this.basePath, key);
    return range && (range.start !== undefined || range.end !== undefined)
      ? createReadStream(path, { start: range.start, end: range.end })
      : createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(this.basePath, key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(this.basePath, key));
      return true;
    } catch {
      return false;
    }
  }

  async quarantine(key: string): Promise<void> {
    const from = this.resolveKey(this.basePath, key);
    const to = join(resolve(this.quarantinePath), key);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  }

  /** Walk the two-level shard tree (ab/cd/<id>) yielding each blob's key + mtime. */
  async *list(): AsyncIterable<{ key: string; mtimeMs: number }> {
    const root = resolve(this.basePath);
    let level1: string[];
    try {
      level1 = await readdir(root);
    } catch {
      return; // storage dir not created yet
    }
    for (const a of level1) {
      if (!/^[a-z0-9]{2}$/.test(a)) continue;
      let level2: string[];
      try {
        level2 = await readdir(join(root, a));
      } catch {
        continue;
      }
      for (const b of level2) {
        if (!/^[a-z0-9]{2}$/.test(b)) continue;
        let files: string[];
        try {
          files = await readdir(join(root, a, b));
        } catch {
          continue;
        }
        for (const f of files) {
          try {
            const s = await stat(join(root, a, b, f));
            if (s.isFile()) yield { key: `${a}/${b}/${f}`, mtimeMs: s.mtimeMs };
          } catch {
            /* vanished between readdir and stat — ignore */
          }
        }
      }
    }
  }
}
