/**
 * Authentication & CSRF plugin.
 *
 * - On every request, resolves the session from the signed httpOnly cookie and
 *   attaches `request.user` / `request.sessionData` (or null).
 * - Exposes `requireAuth` / `requireAdmin` preHandlers that also enforce CSRF on
 *   state-changing methods via the double-submit token.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { CSRF_HEADER, SESSION_COOKIE, safeEqual } from '@opencoperlock/shared';
import { getSession, touchSession } from '../services/session.js';
import { authenticateToken, type ApiScope } from '../services/apiToken.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionData', null);
  app.decorateRequest('apiToken', null);

  // Resolve the session for every request (non-blocking; routes decide if it's required).
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const session = await getSession(unsigned.value);
    if (!session) return;
    req.user = session.user;
    req.sessionData = { id: session.id, csrfSecret: session.csrfSecret };
    // Rolling "last seen" for the session-management view (throttled internally).
    void touchSession(session.id, session.lastSeenAt);
  });

  function enforceCsrf(req: FastifyRequest, reply: FastifyReply): boolean {
    if (!MUTATING_METHODS.has(req.method)) return true;
    const token = req.headers[CSRF_HEADER];
    if (typeof token !== 'string' || !req.sessionData || !safeEqual(token, req.sessionData.csrfSecret)) {
      reply.code(403).send({ error: 'Invalid CSRF token', code: 'CSRF' });
      return false;
    }
    return true;
  }

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'Authentication required' });
    if (req.user.disabled) return reply.code(403).send({ error: 'Account disabled' });
    if (!enforceCsrf(req, reply)) return reply;
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'Authentication required' });
    if (req.user.disabled) return reply.code(403).send({ error: 'Account disabled' });
    if (req.user.role !== 'ADMIN') return reply.code(403).send({ error: 'Admin access required' });
    if (!enforceCsrf(req, reply)) return reply;
  });

  // Bearer-token auth for the public REST API. No cookie is involved, so CSRF does not apply.
  app.decorate('tokenAuth', (scope: ApiScope) => async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await authenticateToken(req.headers.authorization, scope);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    req.user = result.owner;
    req.apiToken = result.token;
  });
};

export default fp(authPlugin, { name: 'auth' });
