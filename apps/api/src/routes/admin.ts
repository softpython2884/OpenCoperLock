import type { FastifyPluginAsync } from 'fastify';
import {
  createQuickCodeSchema,
  createUserSchema,
  randomCode,
  updateSettingsSchema,
  updateUserSchema,
} from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { hashPassword } from '../services/password.js';
import { toPublicQuickCode, toPublicUser } from '../lib/serialize.js';
import { getGlobalCapBytes, getGlobalUsedBytes } from '../services/quota.js';
import { ensureFastUploadFolder } from '../services/fastupload.js';
import { runMaintenance } from '../services/maintenance.js';
import { audit } from '../services/audit.js';

const GLOBAL_SETTING_ID = 'global';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAdmin);
  const defaultQuota = BigInt(app.ctx.env.DEFAULT_USER_QUOTA_BYTES);

  // ── Dashboard stats ────────────────────────────────────────────────────────
  app.get('/stats', async () => {
    const [globalUsedBytes, globalCapBytes, userCount, fileCount] = await Promise.all([
      getGlobalUsedBytes(),
      getGlobalCapBytes(),
      prisma.user.count(),
      prisma.fileObject.count(),
    ]);
    return { globalUsedBytes, globalCapBytes, userCount, fileCount };
  });

  // ── Users ────────────────────────────────────────────────────────────────--
  app.get('/users', async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return { users: users.map(toPublicUser) };
  });

  app.post('/users', async (req, reply) => {
    const body = parseOr400(reply, createUserSchema, req.body);
    if (!body) return;
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ error: 'Email already in use' });

    // undefined quota -> deployment default; explicit null -> unlimited.
    const quotaBytes =
      body.quotaBytes === undefined
        ? defaultQuota
        : body.quotaBytes === null
          ? null
          : BigInt(body.quotaBytes);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash: await hashPassword(body.password),
        role: body.role,
        quotaBytes,
      },
    });
    // Give the new account its Fast-Upload folder up front so it's there from day one.
    await ensureFastUploadFolder(user.id);
    await audit(req, 'admin.user.create', { target: user.id });
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.patch('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(reply, updateUserSchema, req.body);
    if (!body) return;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'User not found' });

    // Guard against an admin locking themselves out.
    if (id === req.user!.id && (body.disabled === true || body.role === 'USER')) {
      return reply.code(400).send({ error: 'You cannot disable or demote your own account' });
    }

    const data: Record<string, unknown> = {};
    if (body.role !== undefined) data.role = body.role;
    if (body.disabled !== undefined) data.disabled = body.disabled;
    if (body.quotaBytes !== undefined) {
      data.quotaBytes = body.quotaBytes === null ? null : BigInt(body.quotaBytes);
    }
    if (body.password !== undefined) data.passwordHash = await hashPassword(body.password);

    const user = await prisma.user.update({ where: { id }, data });
    if (body.disabled === true || body.password !== undefined) {
      // Force re-auth on disable or password change.
      await prisma.session.deleteMany({ where: { userId: id } });
    }
    await audit(req, 'admin.user.update', { target: id });
    return { user: toPublicUser(user) };
  });

  app.delete('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (id === req.user!.id) {
      return reply.code(400).send({ error: 'You cannot delete your own account' });
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: 'User not found' });

    // Remove storage blobs before the cascade drops the file rows.
    const files = await prisma.fileObject.findMany({
      where: { ownerId: id },
      select: { storageKey: true },
    });
    for (const f of files) {
      await app.ctx.storage.delete(f.storageKey).catch((err) => req.log.warn({ err }, 'blob delete failed'));
    }
    await prisma.user.delete({ where: { id } });
    await audit(req, 'admin.user.delete', { target: id });
    return { ok: true };
  });

  // ── Operational alerts ───────────────────────────────────────────────────--
  app.get('/alerts', async () => {
    const [globalUsedBytes, globalCapBytes, infectedCount, users] = await Promise.all([
      getGlobalUsedBytes(),
      getGlobalCapBytes(),
      prisma.fileObject.count({ where: { avStatus: 'INFECTED' } }),
      prisma.user.findMany({ where: { quotaBytes: { not: null } }, select: { email: true, usedBytes: true, quotaBytes: true } }),
    ]);

    const warnings: string[] = [];
    if (globalCapBytes > 0 && globalUsedBytes / globalCapBytes >= 0.9) {
      warnings.push(`Global storage is at ${Math.round((globalUsedBytes / globalCapBytes) * 100)}% of the cap.`);
    }
    if (infectedCount > 0) {
      warnings.push(`${infectedCount} file(s) were flagged as infected and quarantined from scanning.`);
    }
    const nearQuota = users
      .filter((u) => u.quotaBytes && Number(u.usedBytes) / Number(u.quotaBytes) >= 0.9)
      .map((u) => u.email);
    if (nearQuota.length > 0) {
      warnings.push(`${nearQuota.length} user(s) are near their quota: ${nearQuota.slice(0, 5).join(', ')}.`);
    }
    return { warnings, infectedCount };
  });

  // ── Maintenance (manual trigger) ─────────────────────────────────────────--
  app.post('/maintenance', async (req) => {
    const summary = await runMaintenance(app.ctx, req.log);
    await audit(req, 'admin.maintenance.run');
    return summary;
  });

  // ── Global settings ─────────────────────────────────────────────────────--
  app.get('/settings', async () => {
    const setting = await prisma.setting.findUnique({ where: { id: GLOBAL_SETTING_ID } });
    return { globalStorageCapBytes: Number(setting?.globalStorageCapBytes ?? 0n) };
  });

  app.patch('/settings', async (req, reply) => {
    const body = parseOr400(reply, updateSettingsSchema, req.body);
    if (!body) return;
    const setting = await prisma.setting.upsert({
      where: { id: GLOBAL_SETTING_ID },
      create: { id: GLOBAL_SETTING_ID, globalStorageCapBytes: BigInt(body.globalStorageCapBytes) },
      update: { globalStorageCapBytes: BigInt(body.globalStorageCapBytes) },
    });
    await audit(req, 'admin.settings.update');
    return { globalStorageCapBytes: Number(setting.globalStorageCapBytes) };
  });

  // ── Quick-Upload codes ──────────────────────────────────────────────────--
  app.get('/quick-codes', async () => {
    const codes = await prisma.quickUploadCode.findMany({ orderBy: { createdAt: 'desc' } });
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

    // Use the admin's chosen memorable code (already uppercased by the schema), or a
    // random one. Reject a custom code that's already taken.
    const codeValue = body.code ?? randomCode();
    if (body.code) {
      const clash = await prisma.quickUploadCode.findUnique({ where: { code: codeValue } });
      if (clash) return reply.code(409).send({ error: 'This code is already in use' });
    }

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
    await audit(req, 'admin.quickcode.create', { target: code.id });
    return reply.code(201).send({ code: toPublicQuickCode(code) });
  });

  app.delete('/quick-codes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.quickUploadCode.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Code not found' });
    await prisma.quickUploadCode.delete({ where: { id } });
    await audit(req, 'admin.quickcode.delete', { target: id });
    return { ok: true };
  });

  // ── Audit log ───────────────────────────────────────────────────────────--
  app.get('/audit', async (req) => {
    const { limit } = req.query as { limit?: string };
    const take = Math.min(Number(limit) || 100, 500);
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { email: true } } },
    });
    return {
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        target: l.target,
        ip: l.ip,
        actorEmail: l.actor?.email ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });
};
