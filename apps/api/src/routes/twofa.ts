/**
 * Two-factor (TOTP) management. The setup flow stores a *pending* secret, requires the
 * user to prove possession by entering a code, and only then enables 2FA and issues
 * one-time recovery codes. Disabling and regenerating recovery codes require the password.
 */
import type { FastifyPluginAsync } from 'fastify';
import QRCode from 'qrcode';
import { passwordConfirmSchema, totpTokenSchema } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { verifyPassword } from '../services/password.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../services/totp.js';
import {
  clearRecoveryCodes,
  regenerateRecoveryCodes,
  remainingRecoveryCodes,
} from '../services/recovery.js';
import { audit } from '../services/audit.js';

export const twoFactorRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /2fa/status — whether 2FA is on and how many recovery codes remain.
  app.get('/status', async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    return {
      enabled: user.totpEnabled,
      recoveryCodesRemaining: user.totpEnabled ? await remainingRecoveryCodes(user.id) : 0,
    };
  });

  // POST /2fa/setup — generate a pending secret + QR. Does not enable 2FA yet.
  app.post('/setup', async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.totpEnabled) {
      return reply.code(400).send({ error: 'Two-factor is already enabled' });
    }
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    const uri = totpUri(secret, user.email);
    return { secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri) };
  });

  // POST /2fa/enable — verify a code against the pending secret, then turn 2FA on and
  // return the one-time recovery codes (shown once).
  app.post('/enable', async (req, reply) => {
    const body = parseOr400(reply, totpTokenSchema, req.body);
    if (!body) return;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.totpEnabled) return reply.code(400).send({ error: 'Two-factor is already enabled' });
    if (!user.totpSecret) return reply.code(400).send({ error: 'Start setup first' });
    if (!verifyTotp(user.totpSecret, body.token)) {
      return reply.code(400).send({ error: 'Incorrect code' });
    }
    await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    const recoveryCodes = await regenerateRecoveryCodes(user.id);
    await audit(req, 'auth.2fa.enable');
    return { enabled: true, recoveryCodes };
  });

  // POST /2fa/disable — turn 2FA off (password required), clearing secret + recovery codes.
  app.post('/disable', async (req, reply) => {
    const body = parseOr400(reply, passwordConfirmSchema, req.body);
    if (!body) return;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: 'Incorrect password' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    await clearRecoveryCodes(user.id);
    await audit(req, 'auth.2fa.disable');
    return { enabled: false };
  });

  // POST /2fa/recovery/regenerate — issue a fresh set of recovery codes (password required).
  app.post('/recovery/regenerate', async (req, reply) => {
    const body = parseOr400(reply, passwordConfirmSchema, req.body);
    if (!body) return;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.totpEnabled) return reply.code(400).send({ error: 'Two-factor is not enabled' });
    if (!(await verifyPassword(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: 'Incorrect password' });
    }
    const recoveryCodes = await regenerateRecoveryCodes(user.id);
    await audit(req, 'auth.2fa.recovery_regenerate');
    return { recoveryCodes };
  });
};
