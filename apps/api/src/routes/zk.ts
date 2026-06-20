/**
 * Zero-Knowledge vault endpoints. Everything here is opaque to the server: the
 * browser derives a key from the user's passphrase, encrypts the file *and* its
 * name, and ships ciphertext + a wrapped key. We persist those bytes verbatim and
 * can never recover the plaintext. Consequently ZK files are NOT antivirus-scanned.
 */
import type { FastifyPluginAsync } from 'fastify';
import { zkFileMetaSchema } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { newStorageKey } from '../storage/index.js';
import { adjustUsage, remainingAllowance } from '../services/quota.js';
import { trashFile } from '../services/trash.js';
import { audit } from '../services/audit.js';
import { FileTooLargeError } from '../services/ingest.js';
import { Transform, pipeline, type Readable } from 'node:stream';

/**
 * Cap a stream at `maxBytes`, failing (with FileTooLargeError) if exceeded. Implemented as a
 * pass-through Transform that counts bytes as they flow through, then returned for the consumer
 * to pipe into storage.
 *
 * NOTE: do not count by adding a raw `source.on('data')` listener and returning the same stream
 * — that flips the source into flowing mode and the bytes get consumed before the consumer's
 * pipeline attaches, so nothing is written (this caused ZK uploads to store 0 bytes). We wire
 * source -> limiter with stream.pipeline whose callback absorbs the terminal error (so an
 * over-size source can't surface as an uncaught exception); the error still tears down the
 * limiter, so the consumer's pipeline rejects with it and the upload returns 413.
 */
function capStream(source: Readable, maxBytes: number): Readable {
  let total = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(new FileTooLargeError());
        return;
      }
      cb(null, chunk);
    },
  });
  pipeline(source, limiter, () => {});
  return limiter;
}

export const zkRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /zk/files?folderId= — list vault files with the crypto material the client
  // needs to decrypt them locally.
  app.get('/files', async (req, reply) => {
    const { folderId } = req.query as { folderId?: string };
    if (!folderId) return reply.code(400).send({ error: 'folderId is required' });
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, ownerId: req.user!.id, isZeroKnowledge: true },
    });
    if (!folder) return reply.code(404).send({ error: 'Vault folder not found' });

    const files = await prisma.fileObject.findMany({
      where: { ownerId: req.user!.id, folderId, encMode: 'ZK', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return {
      files: files.map((f) => ({
        id: f.id,
        encryptedName: f.zkEncryptedName,
        iv: f.zkIv,
        wrappedKey: f.zkWrappedKey,
        sizeBytes: Number(f.sizeBytes),
        createdAt: f.createdAt.toISOString(),
      })),
    };
  });

  // POST /zk/files — multipart with a `meta` JSON field followed by the `file` blob.
  // We use req.file(): it exposes fields that arrived before the file (our `meta`) and hands
  // back the file stream to consume in place. (Iterating req.parts() and breaking would let
  // the iterator drain the unread file stream, writing zero bytes — the ZK "0 B" bug.)
  app.post('/files', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file provided' });

    const metaRaw = (data.fields?.meta as { value?: string } | undefined)?.value;
    let meta: unknown;
    try {
      meta = JSON.parse(metaRaw ?? '');
    } catch {
      data.file.resume(); // drain so the request can finish cleanly
      return reply.code(400).send({ error: 'Invalid meta JSON' });
    }

    const parsed = zkFileMetaSchema.safeParse(meta);
    if (!parsed.success) {
      data.file.resume();
      return reply.code(400).send({ error: 'Invalid ZK metadata' });
    }

    const folder = await prisma.folder.findFirst({
      where: { id: parsed.data.folderId, ownerId: req.user!.id, isZeroKnowledge: true },
    });
    if (!folder) {
      data.file.resume();
      return reply.code(404).send({ error: 'Vault folder not found' });
    }

    const allowance = await remainingAllowance(req.user!.id);
    if (allowance <= 0) {
      data.file.resume();
      return reply.code(413).send({ error: 'Storage quota exhausted' });
    }

    const storageKey = newStorageKey();
    try {
      const { bytesWritten } = await app.ctx.storage.write(storageKey, capStream(data.file, allowance));
      if (bytesWritten === 0) {
        await app.ctx.storage.delete(storageKey).catch(() => {});
        return reply.code(400).send({ error: 'Empty file' });
      }
      const file = await prisma.fileObject.create({
        data: {
          ownerId: req.user!.id,
          folderId: parsed.data.folderId,
          name: 'zk-encrypted', // placeholder; real name is encrypted client-side
          sizeBytes: BigInt(bytesWritten),
          mimeType: 'application/octet-stream',
          storageKey,
          encMode: 'ZK',
          avStatus: 'SKIPPED', // cannot scan what we cannot decrypt
          zkEncryptedName: parsed.data.encryptedName,
          zkWrappedKey: parsed.data.wrappedKey,
          zkIv: parsed.data.iv,
        },
      });
      await adjustUsage(req.user!.id, bytesWritten);
      await audit(req, 'zk.upload', { target: file.id });
      return reply.code(201).send({ id: file.id });
    } catch (err) {
      await app.ctx.storage.delete(storageKey).catch(() => {});
      if (err instanceof FileTooLargeError) {
        return reply.code(413).send({ error: 'Upload exceeds your available quota' });
      }
      throw err;
    }
  });

  // PUT /zk/files/:id — replace a vault file's contents in place (in-app editor save).
  // Same multipart shape as upload, minus folderId; keeps the same file id and re-points it at
  // the new ciphertext, adjusting quota by the size delta.
  app.put('/files/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.fileObject.findFirst({
      where: { id, ownerId: req.user!.id, encMode: 'ZK', deletedAt: null },
    });
    if (!existing) return reply.code(404).send({ error: 'File not found' });

    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file provided' });
    const metaRaw = (data.fields?.meta as { value?: string } | undefined)?.value;
    let meta: { encryptedName?: unknown; iv?: unknown; wrappedKey?: unknown };
    try {
      meta = JSON.parse(metaRaw ?? '');
    } catch {
      data.file.resume();
      return reply.code(400).send({ error: 'Invalid meta JSON' });
    }
    if (typeof meta.encryptedName !== 'string' || typeof meta.iv !== 'string' || typeof meta.wrappedKey !== 'string') {
      data.file.resume();
      return reply.code(400).send({ error: 'Invalid ZK metadata' });
    }

    // Replacing frees the old blob, so the new one may be up to (remaining + old size).
    const allowance = (await remainingAllowance(req.user!.id)) + Number(existing.sizeBytes);
    if (allowance <= 0) {
      data.file.resume();
      return reply.code(413).send({ error: 'Storage quota exhausted' });
    }

    const newKey = newStorageKey();
    try {
      const { bytesWritten } = await app.ctx.storage.write(newKey, capStream(data.file, allowance));
      if (bytesWritten === 0) {
        await app.ctx.storage.delete(newKey).catch(() => {});
        return reply.code(400).send({ error: 'Empty file' });
      }
      const oldKey = existing.storageKey;
      await prisma.fileObject.update({
        where: { id },
        data: {
          storageKey: newKey,
          sizeBytes: BigInt(bytesWritten),
          zkEncryptedName: meta.encryptedName,
          zkIv: meta.iv,
          zkWrappedKey: meta.wrappedKey,
        },
      });
      await app.ctx.storage.delete(oldKey).catch(() => {});
      await adjustUsage(req.user!.id, bytesWritten - Number(existing.sizeBytes));
      await audit(req, 'zk.update', { target: id });
      return { ok: true };
    } catch (err) {
      await app.ctx.storage.delete(newKey).catch(() => {});
      if (err instanceof FileTooLargeError) {
        return reply.code(413).send({ error: 'Upload exceeds your available quota' });
      }
      throw err;
    }
  });

  // GET /zk/files/:id/blob — stream the raw ciphertext for client-side decryption.
  app.get('/files/:id/blob', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({
      where: { id, ownerId: req.user!.id, encMode: 'ZK' },
    });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', Number(file.sizeBytes));
    return reply.send(app.ctx.storage.createReadStream(file.storageKey));
  });

  // DELETE /zk/files/:id — move a vault file to the Trash (soft-delete).
  app.delete('/files/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({
      where: { id, ownerId: req.user!.id, encMode: 'ZK', deletedAt: null },
    });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    await trashFile(req.user!.id, file.id);
    await audit(req, 'zk.trash', { target: file.id });
    return { ok: true };
  });
};
