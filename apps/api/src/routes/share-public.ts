/**
 * Public recipient endpoints for share links (no authentication required, though an
 * authenticated session is honoured for AUTHENTICATED-mode shares). Mounted under /s.
 *
 * Access policy (expiry, code, sign-in, download cap, download-disabled) is enforced
 * identically here for both metadata and bytes via services/share.ts. A `code` is passed
 * as a query parameter so these stay simple GETs (no CSRF surface).
 */
import type { FastifyPluginAsync } from 'fastify';
import type { PublicShareView } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { decideAccess, isExhausted, isExpired, shareEntries, shareFile } from '../services/share.js';
import { decryptServerFile } from '../services/download.js';
import { audit } from '../services/audit.js';

export const sharePublicRoutes: FastifyPluginAsync = async (app) => {
  // GET /s/:token — recipient metadata. Returns entries only once access is granted.
  app.get('/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const { code } = req.query as { code?: string };
    const share = await prisma.shareLink.findUnique({ where: { token } });
    if (!share) return reply.code(404).send({ error: 'Link not found' });

    const base: PublicShareView = {
      token: share.token,
      viewType: share.viewType,
      access: share.access,
      allowDownload: share.allowDownload,
      isFolder: share.folderId !== null,
    };

    if (isExpired(share) || isExhausted(share)) {
      return { ...base, expired: true };
    }

    const decision = await decideAccess(share, { code, userId: req.user?.id ?? null });
    if (!decision.allowed) {
      return { ...base, requiresCode: decision.requiresCode, requiresAuth: decision.requiresAuth };
    }

    const entries = await shareEntries(share);
    return share.folderId ? { ...base, entries } : { ...base, file: entries[0] };
  });

  // GET /s/:token/file/:fileId — stream a shared file. `inline=1` previews without
  // counting against the download cap; otherwise it's an attachment and is counted.
  app.get('/:token/file/:fileId', async (req, reply) => {
    const { token, fileId } = req.params as { token: string; fileId: string };
    const { code, inline } = req.query as { code?: string; inline?: string };
    const isInline = inline === '1';

    const share = await prisma.shareLink.findUnique({ where: { token } });
    if (!share) return reply.code(404).send({ error: 'Link not found' });
    if (isExpired(share) || isExhausted(share)) return reply.code(410).send({ error: 'Link expired' });

    const decision = await decideAccess(share, { code, userId: req.user?.id ?? null });
    if (!decision.allowed) {
      return reply.code(decision.requiresAuth ? 401 : 403).send({ error: 'Access denied' });
    }
    if (!share.allowDownload && !isInline) {
      return reply.code(403).send({ error: 'Downloads are disabled for this link' });
    }

    const file = await shareFile(share, fileId);
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (file.encMode === 'ZK') return reply.code(400).send({ error: 'Unsupported' });

    if (!isInline) {
      // Count the download atomically and respect the cap under concurrency.
      const claimed = await prisma.shareLink.updateMany({
        where: {
          id: share.id,
          OR: [{ maxDownloads: null }, { downloadCount: { lt: share.maxDownloads ?? 0 } }],
        },
        data: { downloadCount: { increment: 1 } },
      });
      if (claimed.count === 0) return reply.code(410).send({ error: 'Link expired' });
      await audit(req, 'share.download', { actorId: null, target: share.id });
    }

    const disposition = isInline ? 'inline' : 'attachment';
    reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', Number(file.sizeBytes))
      .header('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.name)}"`);
    return reply.send(decryptServerFile(app.ctx, file));
  });
};
