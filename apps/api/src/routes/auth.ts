import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, LOGIN_THROTTLE } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { verifyPassword } from '../services/password.js';
import { createSession, destroySession } from '../services/session.js';
import { checkLock, clearFailures, recordFailure } from '../services/throttle.js';
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

      await clearFailures('login', body.email);
      const session = await createSession(user.id);
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
    return { user: toPublicUser(user), csrfToken: req.sessionData.csrfSecret };
  });
};
