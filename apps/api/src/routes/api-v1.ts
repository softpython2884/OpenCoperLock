/**
 * Public REST API (v1), authenticated by a personal API token: `Authorization: Bearer ocl_…`.
 * Lets a user's own scripts/automations list folders, upload files into a folder, and download
 * them — scoped to the token's permissions (read/write) and optional folder restriction.
 *
 * Zero-Knowledge vaults are encrypted in the browser, so the server API cannot read or write
 * them; only normal (SERVER-encrypted) folders are accessible here.
 */
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { decryptServerFile } from '../services/download.js';
import { FileTooLargeError, InfectedFileError } from '../services/ingest.js';
import { storeUserFile, QuotaExhaustedError } from '../services/upload.js';
import { toPublicFile, toPublicFolder } from '../lib/serialize.js';
import { audit } from '../services/audit.js';

export const apiV1Routes: FastifyPluginAsync = async (app) => {
  // A token may be confined to one folder; everything it touches must match (MVP: exact folder).
  const folderAllowed = (req: { apiToken: { folderId: string | null } | null }, folderId: string | null) =>
    !req.apiToken?.folderId || req.apiToken.folderId === folderId;

  // GET /me — confirm a token works and show what it can do.
  app.get('/me', { preHandler: app.tokenAuth('read') }, async (req) => ({
    user: { id: req.user!.id, email: req.user!.email },
    token: { scopes: req.apiToken!.scopes, folderId: req.apiToken!.folderId },
  }));

  // GET /folders — list the user's normal folders.
  app.get('/folders', { preHandler: app.tokenAuth('read') }, async (req) => {
    const folders = await prisma.folder.findMany({
      where: { ownerId: req.user!.id, spaceId: null },
      orderBy: { name: 'asc' },
    });
    return { folders: folders.map(toPublicFolder) };
  });

  // POST /folders — create a folder ({ name, parentId? }).
  app.post('/folders', { preHandler: app.tokenAuth('write') }, async (req, reply) => {
    const body = (req.body ?? {}) as { name?: unknown; parentId?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const parentId = typeof body.parentId === 'string' ? body.parentId : null;

    if (parentId) {
      const parent = await prisma.folder.findFirst({ where: { id: parentId, ownerId: req.user!.id, spaceId: null } });
      if (!parent) return reply.code(404).send({ error: 'Parent folder not found' });
      if (parent.isZeroKnowledge) return reply.code(400).send({ error: 'Vault folders are not accessible via the API' });
    }
    if (!folderAllowed(req, parentId)) return reply.code(403).send({ error: 'Token is restricted to another folder' });

    const folder = await prisma.folder.create({
      data: { ownerId: req.user!.id, name, parentId, isZeroKnowledge: false },
    });
    await audit(req, 'api.folder.create', { actorId: req.user!.id, target: folder.id });
    return reply.code(201).send({ folder: toPublicFolder(folder) });
  });

  // GET /files?folderId= — list files in a folder (omit folderId for the account root).
  app.get('/files', { preHandler: app.tokenAuth('read') }, async (req, reply) => {
    const { folderId } = req.query as { folderId?: string };
    const target = folderId ?? null;
    if (!folderAllowed(req, target)) return reply.code(403).send({ error: 'Token is restricted to another folder' });
    if (target) {
      const folder = await prisma.folder.findFirst({ where: { id: target, ownerId: req.user!.id, spaceId: null } });
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
    }
    const files = await prisma.fileObject.findMany({
      where: { ownerId: req.user!.id, spaceId: null, folderId: target, encMode: 'SERVER', deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return { files: files.map(toPublicFile) };
  });

  // POST /files?folderId= — upload a single file (multipart/form-data, field "file").
  app.post('/files', { preHandler: app.tokenAuth('write') }, async (req, reply) => {
    const { folderId } = req.query as { folderId?: string };
    const target = folderId ?? req.apiToken!.folderId ?? null;
    if (!folderAllowed(req, target)) return reply.code(403).send({ error: 'Token is restricted to another folder' });

    if (target) {
      const folder = await prisma.folder.findFirst({ where: { id: target, ownerId: req.user!.id, spaceId: null } });
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
      if (folder.isZeroKnowledge) return reply.code(400).send({ error: 'Vault folders are not accessible via the API' });
    }

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file provided (multipart field "file")' });

    try {
      const { file } = await storeUserFile(app.ctx, {
        ownerId: req.user!.id,
        folderId: target,
        stream: part.file,
        filename: part.filename,
        mimetype: part.mimetype,
      });
      await audit(req, 'api.file.upload', { actorId: req.user!.id, target: file.id });
      return reply.code(201).send({ file: toPublicFile(file) });
    } catch (err) {
      if (err instanceof QuotaExhaustedError || err instanceof FileTooLargeError) {
        return reply.code(413).send({ error: 'Upload exceeds your available quota' });
      }
      if (err instanceof InfectedFileError) {
        return reply.code(422).send({ error: `File rejected: ${err.signature}`, code: 'INFECTED' });
      }
      throw err;
    }
  });

  // GET /files/:id/download — stream a file's decrypted contents.
  app.get('/files/:id/download', { preHandler: app.tokenAuth('read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const file = await prisma.fileObject.findFirst({
      where: { id, ownerId: req.user!.id, spaceId: null, encMode: 'SERVER', deletedAt: null },
    });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (!folderAllowed(req, file.folderId)) return reply.code(403).send({ error: 'Token is restricted to another folder' });

    reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', Number(file.sizeBytes))
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    return reply.send(decryptServerFile(app.ctx, file));
  });
};
