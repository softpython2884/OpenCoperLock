/**
 * Shared "store a plaintext file for a user" pipeline, used by the app upload route, the public
 * REST API, and WebDAV — so quota, antivirus, server-side encryption and text-file versioning
 * behave identically everywhere. The caller maps the thrown errors to its own transport.
 */
import type { Readable } from 'node:stream';
import type { FileObject } from '@prisma/client';
import { prisma } from '../db.js';
import type { AppContext } from '../context.js';
import { newStorageKey } from '../storage/index.js';
import { ingestPlaintext } from './ingest.js';
import { adjustUsage, remainingAllowance } from './quota.js';
import { findVersionTarget, isVersionable, pruneVersions, snapshotVersion } from './versioning.js';

export class QuotaExhaustedError extends Error {
  constructor() {
    super('Storage quota exhausted');
  }
}

export interface StoreFileOpts {
  ownerId: string;
  folderId: string | null;
  stream: Readable;
  filename: string;
  mimetype: string;
}

export interface StoreFileResult {
  file: FileObject;
  /** True when an existing same-named text file was versioned instead of duplicated. */
  versioned: boolean;
}

export async function storeUserFile(ctx: AppContext, opts: StoreFileOpts): Promise<StoreFileResult> {
  const allowance = await remainingAllowance(opts.ownerId);
  if (allowance <= 0) throw new QuotaExhaustedError();

  const storageKey = newStorageKey();
  try {
    const result = await ingestPlaintext(ctx, opts.stream, { maxBytes: allowance, storageKey });

    const existing = isVersionable(opts.filename, opts.mimetype)
      ? await findVersionTarget(opts.ownerId, opts.folderId, opts.filename)
      : null;

    if (existing) {
      await snapshotVersion(existing);
      const file = await prisma.fileObject.update({
        where: { id: existing.id },
        data: {
          sizeBytes: BigInt(result.sizeBytes),
          mimeType: opts.mimetype,
          storageKey: result.storageKey,
          wrappedKey: result.wrappedKey,
          iv: result.iv,
          authTag: result.authTag,
          sha256: result.sha256,
          avStatus: result.avStatus,
        },
      });
      await adjustUsage(opts.ownerId, result.sizeBytes);
      const freed = await pruneVersions(ctx, file.id);
      if (freed > 0) await adjustUsage(opts.ownerId, -freed);
      return { file, versioned: true };
    }

    const file = await prisma.fileObject.create({
      data: {
        ownerId: opts.ownerId,
        folderId: opts.folderId,
        name: opts.filename,
        sizeBytes: BigInt(result.sizeBytes),
        mimeType: opts.mimetype,
        storageKey: result.storageKey,
        encMode: 'SERVER',
        wrappedKey: result.wrappedKey,
        iv: result.iv,
        authTag: result.authTag,
        sha256: result.sha256,
        avStatus: result.avStatus,
      },
    });
    await adjustUsage(opts.ownerId, result.sizeBytes);
    return { file, versioned: false };
  } catch (err) {
    await ctx.storage.delete(storageKey).catch(() => {});
    throw err;
  }
}
