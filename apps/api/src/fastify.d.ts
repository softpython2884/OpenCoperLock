import 'fastify';
import type { AppContext } from './context.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    /** preHandler: require an authenticated, enabled user (+ CSRF on mutations). */
    requireAuth: import('fastify').preHandlerHookHandler;
    /** preHandler: require an authenticated ADMIN (+ CSRF on mutations). */
    requireAdmin: import('fastify').preHandlerHookHandler;
  }

  interface FastifyRequest {
    user: { id: string; email: string; role: 'ADMIN' | 'USER'; disabled: boolean } | null;
    sessionData: { id: string; csrfSecret: string } | null;
  }
}
