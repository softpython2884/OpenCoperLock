import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, LOGIN_THROTTLE } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { verifyPassword } from '../services/password.js';
import { createSession, destroySession } from '../services/session.js';
import { checkLock, clearFailures, recordFailure } from '../services/throttle.js';
import { verifyTotp } from '../services/totp.js';
import { consumeRecoveryCode } from '../services/recovery.js';
import { setSessionCookie, clearSessionCookie } from '../lib/cookies.js';
import { toPublicUser } from '../lib/serialize.js';
import { audit } from '../services/audit.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const secureCookies = app.ctx.env.NODE_ENV === 'production';

  // POST /auth/login — exchange credentials for a session cookie + CSRF token.
  // Stricter per-IP rate limit on top of the global one; account lockout layered below.
  const loginOpts = app.ctx.env.RATE_LIMIT_ENABLED
    ? { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }
    : {};
  app.post('/login', loginOpts, async (req, reply) => {
      const body = parseOr400(reply, loginSchema, req.body);
      if (!body) return;

      // Account-targeted lockout: many failures for one email back off exponentially.
      const lock = await checkLock('login', body.email);
      if (lock.locked) {
        reply.header('Retry-After', String(lock.retryAfterSec));
        return reply
          .code(429)
          .send({ error: 'Too many attempts. Try again later.', code: 'LOCKED' });
      }

      const user = await prisma.user.findUnique({ where: { email: body.email } });
      // Verify against the found hash, or a throwaway to keep timing uniform.
      const ok =
        user && !user.disabled ? await verifyPassword(user.passwordHash, body.password) : false;
      if (!user || !ok || user.disabled) {
        const after = await recordFailure('login', body.email, LOGIN_THROTTLE);
        await audit(req, 'auth.login.failed', { actorId: user?.id ?? null, target: body.email });
        if (after.locked) reply.header('Retry-After', String(after.retryAfterSec));
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Second factor, when enabled: accept a 6-digit TOTP or a one-time recovery code.
      if (user.totpEnabled) {
        if (!body.totp) {
          return reply.code(401).send({ error: 'Two-factor code required', code: 'TOTP_REQUIRED' });
        }
        const totpOk = user.totpSecret ? verifyTotp(user.totpSecret, body.totp) : false;
        const recoveryOk = totpOk ? false : await consumeRecoveryCode(user.id, body.totp);
        if (!totpOk && !recoveryOk) {
          const after = await recordFailure('login', body.email, LOGIN_THROTTLE);
          await audit(req, 'auth.login.2fa_failed', { actorId: user.id });
          if (after.locked) reply.header('Retry-After', String(after.retryAfterSec));
          return reply.code(401).send({ error: 'Invalid two-factor code', code: 'TOTP_INVALID' });
        }
      }

      await clearFailures('login', body.email);
      const session = await createSession(user.id, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] ?? null,
      });
      setSessionCookie(reply, session.id, session.expiresAt, secureCookies);
      await audit(req, 'auth.login', { actorId: user.id });
      return { user: toPublicUser(user), csrfToken: session.csrfSecret };
  });

  // POST /auth/logout — destroy the current session.
  app.post('/logout', { preHandler: app.requireAuth }, async (req, reply) => {
    if (req.sessionData) await destroySession(req.sessionData.id);
    clearSessionCookie(reply, secureCookies);
    return { ok: true };
  });

  // GET /auth/me — current user + a fresh CSRF token for the SPA.
  app.get('/me', async (req, reply) => {
    if (!req.user || !req.sessionData) return reply.code(401).send({ error: 'Not authenticated' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return reply.code(401).send({ error: 'Not authenticated' });
    return {
      user: toPublicUser(user),
      csrfToken: req.sessionData.csrfSecret,
      totpEnabled: user.totpEnabled,
    };
  });

  // GET /auth/sessions — the user's active sessions, so they can spot unfamiliar ones.
  app.get('/sessions', { preHandler: app.requireAuth }, async (req) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, lastSeenAt: true, createdAt: true },
    });
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        lastSeenAt: s.lastSeenAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        current: s.id === req.sessionData!.id,
      })),
    };
  });

  // DELETE /auth/sessions/:id — revoke one session (e.g. a suspicious one).
  app.delete('/sessions/:id', { preHandler: app.requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await prisma.session.deleteMany({ where: { id, userId: req.user!.id } });
    if (res.count === 0) return reply.code(404).send({ error: 'Session not found' });
    await audit(req, 'auth.session.revoke', { target: id });
    return { ok: true };
  });

  // DELETE /auth/sessions — revoke every other session (keep the current one).
  app.delete('/sessions', { preHandler: app.requireAuth }, async (req) => {
    const res = await prisma.session.deleteMany({
      where: { userId: req.user!.id, id: { not: req.sessionData!.id } },
    });
    await audit(req, 'auth.session.revoke_others');
    return { ok: true, revoked: res.count };
  });
};
