import type { FastifyPluginAsync } from 'fastify';
import { updateFileSchema } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { FileTooLargeError, InfectedFileError } from '../services/ingest.js';
import { storeUserFile, QuotaExhaustedError } from '../services/upload.js';
import { decryptServerFile } from '../services/download.js';
import { hardDeleteFile, trashFile } from '../services/trash.js';
import { pruneVersions, snapshotVersion } from '../services/versioning.js';
import { adjustUsage } from '../services/quota.js';
import { toPublicFile } from '../lib/serialize.js';
import { audit } from '../services/audit.js';

export const fileRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /files?folderId= — list files in a folder (or root when omitted).
  app.get('/', async (req) => {
    const { folderId } = req.query as { folderId?: string };
    const files = await prisma.fileObject.findMany({
      where: { ownerId: req.user!.id, spaceId: null, folderId: folderId ?? null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { files: files.map(toPublicFile) };
  });

  // GET /files/search?q= — find the user's NORMAL files by name (vault files are encrypted and
  // never searchable server-side). Powers the Ctrl/⌘+K palette's global file lookup.
  app.get('/search', async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: string };
    const term = (q ?? '').trim();
    if (term.length < 1) return { files: [] };
    const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const files = await prisma.fileObject.findMany({
      where: {
        ownerId: req.user!.id,
        spaceId: null,
        encMode: 'SERVER',
        deletedAt: null,
        name: { contains: term, mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      take,
    });
    return { files: files.map(toPublicFile) };
  });

  // POST /files?folderId= — streaming upload. Server-side encrypted normally; stored plaintext
  // (and given a public URL) when the target folder is a Public/Open space.
  app.post('/', async (req, reply) => {
    const { folderId } = req.query as { folderId?: string };

    let isPublicFolder = false;
    if (folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderId, ownerId: req.user!.id, spaceId: null },
      });
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
      if (folder.isZeroKnowledge) {
        return reply
          .code(400)
          .send({ error: 'Use the Zero-Knowledge upload endpoint for vault folders' });
      }
      isPublicFolder = folder.isPublic;
    }

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file provided' });

    try {
      // Shared pipeline: quota + antivirus + (encryption or plaintext-for-public) + text-file
      // versioning, plus outgoing-webhook dispatch — identical to the REST API and WebDAV.
      const { file, versioned } = await storeUserFile(app.ctx, {
        ownerId: req.user!.id,
        folderId: folderId ?? null,
        stream: part.file,
        filename: part.filename,
        mimetype: part.mimetype,
        public: isPublicFolder,
      });
      await audit(req, versioned ? 'file.version' : 'file.upload', { target: file.id });
      return reply.code(201).send({ file: toPublicFile(file) });
    } catch (err) {
      if (err instanceof QuotaExhaustedError) {
        return reply.code(413).send({ error: 'Storage quota exhausted' });
      }
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
      where: { id, ownerId: req.user!.id, spaceId: null },
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
    // PUBLIC files are stored plaintext (Public/Open space); everything else is decrypted.
    return reply.send(
      file.encMode === 'PUBLIC'
        ? app.ctx.storage.createReadStream(file.storageKey)
        : decryptServerFile(app.ctx, file),
    );
  });

  // PATCH /files/:id — rename and/or move a SERVER-mode file.
  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(reply, updateFileSchema, req.body);
    if (!body) return;

    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id, spaceId: null } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (file.encMode === 'ZK') {
      return reply.code(400).send({ error: 'Vault files are managed through the vault API' });
    }

    if (body.folderId !== undefined && body.folderId !== null) {
      const folder = await prisma.folder.findFirst({
        where: { id: body.folderId, ownerId: req.user!.id, spaceId: null },
      });
      if (!folder) return reply.code(404).send({ error: 'Target folder not found' });
      if (folder.isZeroKnowledge) {
        return reply.code(400).send({ error: 'Cannot move a plaintext file into a vault' });
      }
    }

    const updated = await prisma.fileObject.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      },
    });
    await audit(req, 'file.update', { target: id });
    return { file: toPublicFile(updated) };
  });

  // GET /files/:id/versions — list retained prior versions (newest first).
  app.get('/:id/versions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id, spaceId: null } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    const versions = await prisma.fileVersion.findMany({
      where: { fileId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, sizeBytes: true, sha256: true, createdAt: true },
    });
    return {
      versions: versions.map((v) => ({
        id: v.id,
        sizeBytes: Number(v.sizeBytes),
        sha256: v.sha256,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  });

  // GET /files/:id/versions/:versionId/download — decrypt and stream a past version.
  app.get('/:id/versions/:versionId/download', async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string };
    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id, spaceId: null } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    const version = await prisma.fileVersion.findFirst({ where: { id: versionId, fileId: id } });
    if (!version) return reply.code(404).send({ error: 'Version not found' });
    reply
      .header('Content-Type', version.mimeType)
      .header('Content-Length', Number(version.sizeBytes))
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    return reply.send(decryptServerFile(app.ctx, version));
  });

  // POST /files/:id/versions/:versionId/restore — make a past version current. The current
  // content is first snapshotted as a new version, so nothing is lost (a metadata swap).
  app.post('/:id/versions/:versionId/restore', async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string };
    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id, spaceId: null } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    const version = await prisma.fileVersion.findFirst({ where: { id: versionId, fileId: id } });
    if (!version) return reply.code(404).send({ error: 'Version not found' });

    await snapshotVersion(file);
    const updated = await prisma.fileObject.update({
      where: { id },
      data: {
        sizeBytes: version.sizeBytes,
        mimeType: version.mimeType,
        storageKey: version.storageKey,
        wrappedKey: version.wrappedKey,
        iv: version.iv,
        authTag: version.authTag,
        sha256: version.sha256,
      },
    });
    // The restored version's blob is now the live content; remove its version row.
    await prisma.fileVersion.delete({ where: { id: versionId } });
    // Net usage change is zero: the old current blob becomes a version while the restored
    // version's blob becomes current — both blobs remain referenced. Only pruning frees space.
    const freed = await pruneVersions(app.ctx, id);
    if (freed > 0) await adjustUsage(req.user!.id, -freed);
    await audit(req, 'file.version.restore', { target: id });
    return { file: toPublicFile(updated) };
  });

  // DELETE /files/:id — Trash a normal file (recoverable, still counts against quota until
  // purged). A Zero-Knowledge file is permanently deleted at once instead (opaque ciphertext has
  // no business sitting in a recoverable Trash); this also frees its quota immediately.
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id, spaceId: null } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (file.encMode === 'ZK') {
      await hardDeleteFile(app.ctx, req.user!.id, id);
      await audit(req, 'file.delete', { target: id });
      return { ok: true };
    }
    const ok = await trashFile(req.user!.id, id);
    if (!ok) return reply.code(404).send({ error: 'File not found' });
    await audit(req, 'file.trash', { target: id });
    return { ok: true };
  });

  // POST /files/:id/virustotal — on-demand hash lookup (no file contents sent).
  app.post('/:id/virustotal', async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({ where: { id, ownerId: req.user!.id, spaceId: null } });
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
