/**
 * Owner-facing share management. Create a link to a SERVER-mode file or folder, list your
 * links, and revoke them. ZK targets are refused because the server cannot serve their
 * plaintext. The public recipient endpoints live in routes/share-public.ts.
 */
import type { FastifyPluginAsync } from 'fastify';
import { createShareSchema, randomToken } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { toPublicShare } from '../lib/serialize.js';
import { hashPassword } from '../services/password.js';
import { audit } from '../services/audit.js';

export const shareRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /shares — the user's links, with the target's display name.
  app.get('/', async (req) => {
    const shares = await prisma.shareLink.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      include: { file: { select: { name: true } }, folder: { select: { name: true } } },
    });
    return {
      shares: shares.map((s) =>
        toPublicShare(s, s.file?.name ?? s.folder?.name ?? '(deleted)'),
      ),
    };
  });

  // POST /shares — create a share for a file or folder.
  app.post('/', async (req, reply) => {
    const body = parseOr400(reply, createShareSchema, req.body);
    if (!body) return;

    let targetName: string;
    if (body.fileId) {
      const file = await prisma.fileObject.findFirst({
        where: { id: body.fileId, ownerId: req.user!.id, spaceId: null },
      });
      if (!file) return reply.code(404).send({ error: 'File not found' });
      if (file.encMode === 'ZK') {
        return reply.code(400).send({ error: 'Zero-knowledge files cannot be shared' });
      }
      targetName = file.name;
    } else {
      const folder = await prisma.folder.findFirst({
        where: { id: body.folderId!, ownerId: req.user!.id, spaceId: null },
      });
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
      if (folder.isZeroKnowledge) {
        return reply.code(400).send({ error: 'Vault folders cannot be shared' });
      }
      targetName = folder.name;
    }

    const share = await prisma.shareLink.create({
      data: {
        token: randomToken(18),
        ownerId: req.user!.id,
        fileId: body.fileId ?? null,
        folderId: body.folderId ?? null,
        viewType: body.viewType,
        access: body.accessMode,
        codeHash: body.accessMode === 'CODE' && body.code ? await hashPassword(body.code) : null,
        allowDownload: body.allowDownload ?? true,
        expiresAt: body.expiresAt ?? null,
        maxDownloads: body.maxDownloads ?? null,
      },
    });
    await audit(req, 'share.create', { target: share.id });
    return reply.code(201).send({ share: toPublicShare(share, targetName) });
  });

  // DELETE /shares/:id — revoke a link.
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const share = await prisma.shareLink.findFirst({ where: { id, ownerId: req.user!.id } });
    if (!share) return reply.code(404).send({ error: 'Share not found' });
    await prisma.shareLink.delete({ where: { id } });
    await audit(req, 'share.delete', { target: id });
    return { ok: true };
  });
};
