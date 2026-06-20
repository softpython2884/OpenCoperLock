import type { Readable } from 'node:stream';

/**
 * Storage driver contract. The driver stores *opaque blobs* — it knows nothing
 * about encryption. For SERVER-mode files the bytes are already AES-GCM ciphertext;
 * for ZK files they are client-side ciphertext. Either way the driver just persists
 * and returns bytes.
 *
 * Ships with a local-filesystem implementation; an S3-compatible driver can satisfy
 * the same interface later without touching the routes.
 */
export interface StorageDriver {
  /** Persist a stream under `key`. Returns the number of bytes written. */
  write(key: string, data: Readable): Promise<{ bytesWritten: number }>;
  /** Open a readable stream for the blob at `key`. */
  createReadStream(key: string): Readable;
  /** Permanently remove the blob. No-op if it does not exist. */
  delete(key: string): Promise<void>;
  /** Whether a blob exists at `key`. */
  exists(key: string): Promise<boolean>;
  /** Move an (infected) blob out of active storage into the quarantine area. */
  quarantine(key: string): Promise<void>;
  /**
   * Enumerate stored blobs with their last-modified time, for orphan garbage collection.
   * Optional: a driver that cannot list (e.g. a future write-only sink) may omit it, in
   * which case GC is skipped.
   */
  list?(): AsyncIterable<{ key: string; mtimeMs: number }>;
}
