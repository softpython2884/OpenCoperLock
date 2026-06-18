import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { newStorageKey } from '../storage/index.js';
import {
  FileTooLargeError,
  InfectedFileError,
  ingestPlaintext,
} from '../services/ingest.js';
import { decryptServerFile } from '../services/download.js';
import { adjustUsage, remainingAllowance } from '../services/quota.js';
import { toPublicFile } from '../lib/serialize.js';
import { audit } from '../services/audit.js';

export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /files?folderId= — list files in a folder (or root when omitted).
  app.get('/', async (req) => {
    const { folderId } = req.query as { folderId?: string };
    const files = await prisma.fileObject.findMany({
      where: { ownerId: req.user!.id, folderId: folderId ?? null },
      orderBy: { createdAt: 'desc' },
    });
    return { files: files.map(toPublicFile) };
  });

  // POST /files?folderId= — streaming, server-side-encrypted upload.
  app.post('/', async (req, reply) => {
    const { folderId } = req.query as { folderId?: string };

    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, ownerId: req.user!.id },
      });
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
      if (folder.isZeroKnowledge) {
        return reply
          .code(400)
          .send({ error: 'Use the Zero-Knowledge upload endpoint for vault folders' });
      }
    }

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file provided' });

    const allowance = await remainingAllowance(req.user!.id);
    if (allowance <= 0) return reply.code(413).send({ error: 'Storage quota exhausted' });

    const storageKey = newStorageKey();
    try {
      const result = await ingestPlaintext(app.ctx, part.file, { maxBytes: allowance, storageKey });

      const file = await prisma.fileObject.create({
        data: {
          ownerId: req.user!.id,
          folderId: folderId ?? null,
          name: part.filename,
          sizeBytes: BigInt(result.sizeBytes),
          mimeType: part.mimetype,
          storageKey: result.storageKey,
          encMode: 'SERVER',
          wrappedKey: result.wrappedKey,
          iv: result.iv,
          authTag: result.authTag,
          sha256: result.sha256,
          avStatus: result.avStatus,
        },
      });
      await adjustUsage(req.user!.id, result.sizeBytes);
      await audit(req, 'file.upload', { target: file.id });
      return reply.code(201).send({ file: toPublicFile(file) });
    } catch (err) {
      await app.ctx.storage.delete(storageKey).catch(() => {});
      if (err instanceof FileTooLargeError) {
        return reply.code(413).send({ error: 'Upload exceeds your available quota' });
      }
      if (err instanceof InfectedFileError) {
        await audit(req, 'file.infected', { target: err.signature });
        return reply.code(422).send({ error: `File rejected: ${err.signature}`, code: 'INFECTED' });
      }
      throw err;
    }
  });

  // GET /files/:id/download — decrypt and stream a SERVER-mode file.
  app.get('/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({
      where: { id, ownerId: req.user!.id },
    });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (file.encMode === 'ZK') {
      return reply.code(400).send({ error: 'Zero-Knowledge files are fetched via the vault API' });
    }

    await audit(req, 'file.download', { target: file.id });
    reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', Number(file.sizeBytes))
      .header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(file.name)}"`,
      );
    return reply.send(decryptServerFile(app.ctx, file));
  });

  // DELETE /files/:id — remove the blob and release quota.
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id } });
    if (!file) return reply.code(404).send({ error: 'File not found' });

    await app.ctx.storage.delete(file.storageKey).catch((err) => req.log.warn({ err }, 'blob delete failed'));
    await prisma.fileObject.delete({ where: { id: file.id } });
    await adjustUsage(req.user!.id, -Number(file.sizeBytes));
    await audit(req, 'file.delete', { target: file.id });
    return { ok: true };
  });

  // POST /files/:id/virustotal — on-demand hash lookup (no file contents sent).
  app.post('/:id/virustotal', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (!file.sha256) return reply.code(400).send({ error: 'File has no hash to look up' });
    if (!app.ctx.virustotal.enabled) {
      return reply.code(503).send({ error: 'VirusTotal is not configured' });
    }
    const report = await app.ctx.virustotal.lookupHash(file.sha256);
    await audit(req, 'file.virustotal', { target: file.id });
    return { report };
  });
};
