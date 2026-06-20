import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { AppContext } from './context.js';
import { getHealth } from './services/health.js';
import { parseTrustProxy } from './lib/trust-proxy.js';
import authPlugin from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { folderRoutes } from './routes/folders.js';
import { fileRoutes } from './routes/files.js';
import { zkRoutes } from './routes/zk.js';
import { quickRoutes } from './routes/quick.js';
import { remoteRoutes } from './routes/remote.js';
import { shareRoutes } from './routes/shares.js';
import { sharePublicRoutes } from './routes/share-public.js';
import { twoFactorRoutes } from './routes/twofa.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level:
        ctx.env.NODE_ENV === 'test'
          ? 'silent'
          : ctx.env.NODE_ENV === 'production'
            ? 'info'
            : 'debug',
      transport:
        ctx.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    // Derive the client IP from X-Forwarded-* according to the TRUST_PROXY policy. Behind
    // nginx this must be set (e.g. TRUST_PROXY=1) or req.ip would be the proxy's address.
    trustProxy: parseTrustProxy(ctx.env.TRUST_PROXY),
    bodyLimit: 1_048_576, // 1 MiB for JSON bodies; file uploads use multipart streaming.
  });

  app.decorate('ctx', ctx);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: ctx.env.APP_URL, credentials: true });
  await app.register(cookie, { secret: ctx.env.SESSION_SECRET });
  await app.register(rateLimit, {
    max: ctx.env.RATE_LIMIT_ENABLED ? 300 : 1_000_000,
    timeWindow: '1 minute',
  });
  await app.register(multipart, {
    limits: {
      // The real ceiling is the user's quota, enforced while streaming in ingest.
      // This guards against a single absurdly large part.
      fileSize: 10 * 1024 ** 4, // 10 TiB
      files: 1,
    },
  });

  await app.register(authPlugin);

  // Liveness: the process is up. Readiness: dependencies (DB + storage) are usable.
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_req, reply) => {
    const report = await getHealth(ctx);
    return reply.code(report.ready ? 200 : 503).send(report);
  });
  // Authenticated status for the UI banner (warnings about degraded components).
  app.get('/status', { preHandler: app.requireAuth }, async () => getHealth(ctx));

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(folderRoutes, { prefix: '/folders' });
  await app.register(fileRoutes, { prefix: '/files' });
  await app.register(zkRoutes, { prefix: '/zk' });
  await app.register(quickRoutes, { prefix: '/quick' });
  await app.register(remoteRoutes, { prefix: '/remote' });
  await app.register(shareRoutes, { prefix: '/shares' });
  await app.register(sharePublicRoutes, { prefix: '/s' });
  await app.register(twoFactorRoutes, { prefix: '/2fa' });
  await app.register(accountRoutes, { prefix: '/account' });
  await app.register(adminRoutes, { prefix: '/admin' });

  app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
    req.log.error({ err }, 'request failed');
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({
      error: status === 500 ? 'Internal server error' : (err.message ?? 'Error'),
    });
  });

  return app;
}
