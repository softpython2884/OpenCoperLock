import 'fastify';
import type { AppContext } from './context.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    /** preHandler: require an authenticated, enabled user (+ CSRF on mutations). */
    requireAuth: import('fastify').preHandlerHookHandler;
    /** preHandler: require an authenticated ADMIN (+ CSRF on mutations). */
    requireAdmin: import('fastify').preHandlerHookHandler;
    /** preHandler factory: require a valid API token (Authorization: Bearer) with a scope. */
    tokenAuth: (scope: 'read' | 'write') => import('fastify').preHandlerHookHandler;
  }

  interface FastifyRequest {
    user: { id: string; email: string; role: 'ADMIN' | 'USER'; disabled: boolean } | null;
    sessionData: { id: string; csrfSecret: string } | null;
    /** Set when the request authenticated via an API token instead of a session. */
    apiToken: { id: string; ownerId: string; scopes: string[]; folderId: string | null } | null;
  }
}
