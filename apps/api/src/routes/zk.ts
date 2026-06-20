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
import type { Readable } from 'node:stream';

/** Cap a stream at `maxBytes`, destroying it (and signalling) if exceeded. */
function capStream(source: Readable, maxBytes: number): Readable {
  let total = 0;
  source.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > maxBytes) source.destroy(new FileTooLargeError());
  });
  return source;
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
  app.post('/files', async (req, reply) => {
    let meta: unknown;
    let blob: Readable | undefined;
    let blobPart: Awaited<ReturnType<typeof req.file>> | undefined;

    for await (const part of req.parts()) {
      if (part.type === 'field' && part.fieldname === 'meta') {
        try {
          meta = JSON.parse(part.value as string);
        } catch {
          return reply.code(400).send({ error: 'Invalid meta JSON' });
        }
      } else if (part.type === 'file') {
        blobPart = part;
        blob = part.file;
        break; // the file part must be sent last
      }
    }

    const parsed = zkFileMetaSchema.safeParse(meta);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid ZK metadata' });
    if (!blob || !blobPart) return reply.code(400).send({ error: 'No file provided' });

    const folder = await prisma.folder.findFirst({
      where: { id: parsed.data.folderId, ownerId: req.user!.id, isZeroKnowledge: true },
    });
    if (!folder) return reply.code(404).send({ error: 'Vault folder not found' });

    const allowance = await remainingAllowance(req.user!.id);
    if (allowance <= 0) return reply.code(413).send({ error: 'Storage quota exhausted' });

    const storageKey = newStorageKey();
    try {
      const { bytesWritten } = await app.ctx.storage.write(storageKey, capStream(blob, allowance));
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
