/**
 * Self-service account actions for data-protection (GDPR): export a copy of your data, and
 * permanently delete your account. Both are scoped strictly to the requesting user.
 */
import type { FastifyPluginAsync } from 'fastify';
import { passwordConfirmSchema, createQuickCodeSchema, createApiTokenSchema } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { verifyPassword, hashPassword } from '../services/password.js';
import { remainingRecoveryCodes } from '../services/recovery.js';
import { toPublicFile, toPublicFolder, toPublicShare, toPublicUser, toPublicQuickCode, toPublicApiToken } from '../lib/serialize.js';
import { clearSessionCookie } from '../lib/cookies.js';
import { audit } from '../services/audit.js';
import { generateUniqueQuickCode, isCodeTakenError } from '../services/quickCode.js';
import { generateToken } from '../services/apiToken.js';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);
  const secureCookies = app.ctx.env.NODE_ENV === 'production';

  // ── Quick-Upload codes (self-service) ────────────────────────────────────────
  // Every user manages their OWN Quick-Upload codes here; an anonymous guest with the code
  // can drop files straight into the chosen folder. Strictly scoped to the requesting user.

  app.get('/quick-codes', async (req) => {
    const codes = await prisma.quickUploadCode.findMany({
      where: { createdById: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    return { codes: codes.map(toPublicQuickCode) };
  });

  app.post('/quick-codes', async (req, reply) => {
    const body = parseOr400(reply, createQuickCodeSchema, req.body);
    if (!body) return;

    if (body.targetFolderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: body.targetFolderId, ownerId: req.user!.id },
      });
      if (!folder) return reply.code(404).send({ error: 'Target folder not found' });
      if (folder.isZeroKnowledge) {
        return reply.code(400).send({ error: 'A vault cannot be a Quick-Upload target' });
      }
    }

    const codeValue = body.code ?? (await generateUniqueQuickCode());
    if (body.code) {
      const clash = await prisma.quickUploadCode.findUnique({ where: { code: codeValue } });
      if (clash) return reply.code(409).send({ error: 'This code is already in use' });
    }

    try {
      const code = await prisma.quickUploadCode.create({
        data: {
          code: codeValue,
          createdById: req.user!.id,
          targetFolderId: body.targetFolderId ?? null,
          maxBytes: body.maxBytes == null ? null : BigInt(body.maxBytes),
          expiresAt: body.expiresAt ?? null,
          usageLimit: body.usageLimit ?? null,
          passwordHash: body.password ? await hashPassword(body.password) : null,
        },
      });
      await audit(req, 'account.quickcode.create', { target: code.id });
      return reply.code(201).send({ code: toPublicQuickCode(code) });
    } catch (err) {
      // Lost a race for the same custom code between the check and the insert.
      if (isCodeTakenError(err)) return reply.code(409).send({ error: 'This code is already in use' });
      throw err;
    }
  });

  app.delete('/quick-codes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    // Scope the delete to the owner so a user can only remove their own codes.
    const existing = await prisma.quickUploadCode.findFirst({
      where: { id, createdById: req.user!.id },
    });
    if (!existing) return reply.code(404).send({ error: 'Code not found' });
    await prisma.quickUploadCode.delete({ where: { id } });
    await audit(req, 'account.quickcode.delete', { target: id });
    return { ok: true };
  });

  // ── Personal API tokens ──────────────────────────────────────────────────────
  app.get('/api-tokens', async (req) => {
    const tokens = await prisma.apiToken.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    return { tokens: tokens.map(toPublicApiToken) };
  });

  app.post('/api-tokens', async (req, reply) => {
    const body = parseOr400(reply, createApiTokenSchema, req.body);
    if (!body) return;

    if (body.folderId) {
      const folder = await prisma.folder.findFirst({ where: { id: body.folderId, ownerId: req.user!.id } });
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
      if (folder.isZeroKnowledge) return reply.code(400).send({ error: 'A vault cannot be an API target' });
    }

    const { token, hash, prefix } = generateToken();
    const created = await prisma.apiToken.create({
      data: {
        ownerId: req.user!.id,
        name: body.name,
        tokenHash: hash,
        prefix,
        scopes: body.scopes.join(','),
        folderId: body.folderId ?? null,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      },
    });
    await audit(req, 'account.apitoken.create', { target: created.id });
    // The plaintext token is returned ONCE here and never stored or shown again.
    return reply.code(201).send({ token, apiToken: toPublicApiToken(created) });
  });

  app.delete('/api-tokens/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.apiToken.findFirst({ where: { id, ownerId: req.user!.id } });
    if (!existing) return reply.code(404).send({ error: 'Token not found' });
    await prisma.apiToken.delete({ where: { id } });
    await audit(req, 'account.apitoken.delete', { target: id });
    return { ok: true };
  });

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
