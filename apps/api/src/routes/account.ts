/**
 * Self-service account actions for data-protection (GDPR): export a copy of your data, and
 * permanently delete your account. Both are scoped strictly to the requesting user.
 */
import type { FastifyPluginAsync } from 'fastify';
import { passwordConfirmSchema } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { verifyPassword } from '../services/password.js';
import { remainingRecoveryCodes } from '../services/recovery.js';
import { toPublicFile, toPublicFolder, toPublicShare, toPublicUser } from '../lib/serialize.js';
import { clearSessionCookie } from '../lib/cookies.js';
import { audit } from '../services/audit.js';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  const secureCookies = app.ctx.env.NODE_ENV === 'production';

  // GET /account/export — a JSON copy of the user's data (metadata, not file contents).
  app.get('/export', async (req, reply) => {
    const userId = req.user!.id;
    const [user, folders, files, shares, sessions, logs] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.folder.findMany({ where: { ownerId: userId } }),
      prisma.fileObject.findMany({ where: { ownerId: userId } }),
      prisma.shareLink.findMany({ where: { ownerId: userId } }),
      prisma.session.findMany({
        where: { userId },
        select: { ip: true, userAgent: true, lastSeenAt: true, createdAt: true },
      }),
      prisma.auditLog.findMany({ where: { actorId: userId }, orderBy: { createdAt: 'desc' }, take: 1000 }),
    ]);

    const data = {
      exportedAt: new Date().toISOString(),
      user: { ...toPublicUser(user), twoFactorEnabled: user.totpEnabled },
      recoveryCodesRemaining: await remainingRecoveryCodes(userId),
      folders: folders.map(toPublicFolder),
      files: files.map(toPublicFile),
      shares: shares.map((s) => toPublicShare(s, '')),
      sessions: sessions.map((s) => ({
        ip: s.ip,
        userAgent: s.userAgent,
        lastSeenAt: s.lastSeenAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
      activity: logs.map((l) => ({ action: l.action, target: l.target, ip: l.ip, at: l.createdAt.toISOString() })),
    };

    await audit(req, 'account.export');
    reply
      .header('Content-Type', 'application/json')
      .header('Content-Disposition', 'attachment; filename="opencoperlock-export.json"');
    return reply.send(JSON.stringify(data, null, 2));
  });

  // POST /account/delete — permanently delete the account (password required). Removes the
  // user's storage blobs first, then the row (which cascades folders/files/shares/etc.).
  app.post('/delete', async (req, reply) => {
    const body = parseOr400(reply, passwordConfirmSchema, req.body);
    if (!body) return;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: 'Incorrect password' });
    }
    // Don't allow the last admin to delete themselves and lock the instance out.
    if (user.role === 'ADMIN') {
      const admins = await prisma.user.count({ where: { role: 'ADMIN' } });
      if (admins <= 1) {
        return reply.code(400).send({ error: 'Cannot delete the only administrator account' });
      }
    }

    const [files, versions] = await Promise.all([
      prisma.fileObject.findMany({ where: { ownerId: user.id }, select: { storageKey: true } }),
      prisma.fileVersion.findMany({ where: { file: { ownerId: user.id } }, select: { storageKey: true } }),
    ]);
    for (const f of [...files, ...versions]) {
      await app.ctx.storage.delete(f.storageKey).catch(() => {});
    }
    await audit(req, 'account.delete', { actorId: user.id, target: user.id });
    await prisma.user.delete({ where: { id: user.id } });
    clearSessionCookie(reply, secureCookies);
    return { ok: true };
  });
};
