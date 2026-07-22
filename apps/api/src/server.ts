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
import { trashRoutes } from './routes/trash.js';
import { zkRoutes } from './routes/zk.js';
import { quickRoutes } from './routes/quick.js';
import { remoteRoutes } from './routes/remote.js';
import { shareRoutes } from './routes/shares.js';
import { spaceRoutes } from './routes/spaces.js';
import { versionRoutes } from './routes/version.js';
import { sharePublicRoutes } from './routes/share-public.js';
import { publicMediaRoutes } from './routes/public-media.js';
import { twoFactorRoutes } from './routes/twofa.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { apiV1Routes } from './routes/api-v1.js';
import { webdavRoutes } from './routes/webdav.js';

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

  // Teach Fastify the WebDAV verbs before the routes that use them are registered.
  for (const m of ['PROPFIND', 'PROPPATCH', 'MKCOL', 'MOVE', 'COPY', 'LOCK', 'UNLOCK']) {
    app.addHttpMethod(m, { hasBody: ['PROPFIND', 'PROPPATCH', 'MKCOL', 'LOCK'].includes(m) });
  }

  // WebDAV is mounted OUTSIDE the CORS scope below: @fastify/cors uses strictPreflight and would
  // answer every WebDAV OPTIONS with 400/204, hiding the DAV capability headers clients need.
  await app.register(webdavRoutes, { prefix: '/dav' });

  // Public media (Public/Open spaces) is also mounted outside the browser CORS scope so its own
  // wildcard `Access-Control-Allow-Origin: *` (for embedding on any site) isn't overridden.
  await app.register(publicMediaRoutes, { prefix: '/p' });

  // Everything browser-facing is wrapped so CORS applies only here (not to WebDAV).
  await app.register(async (web) => {
    await web.register(cors, { origin: ctx.env.APP_URL, credentials: true });

    // Liveness: the process is up. Readiness: dependencies (DB + storage) are usable.
    web.get('/health', async () => ({ status: 'ok' }));
    web.get('/ready', async (_req, reply) => {
      const report = await getHealth(ctx);
      return reply.code(report.ready ? 200 : 503).send(report);
    });
    // Authenticated status for the UI banner (warnings about degraded components).
    web.get('/status', { preHandler: web.requireAuth }, async () => getHealth(ctx));

    await web.register(authRoutes, { prefix: '/auth' });
    await web.register(folderRoutes, { prefix: '/folders' });
    await web.register(fileRoutes, { prefix: '/files' });
    await web.register(trashRoutes, { prefix: '/trash' });
    await web.register(zkRoutes, { prefix: '/zk' });
    await web.register(quickRoutes, { prefix: '/quick' });
    await web.register(remoteRoutes, { prefix: '/remote' });
    await web.register(shareRoutes, { prefix: '/shares' });
    await web.register(spaceRoutes, { prefix: '/spaces' });
    await web.register(sharePublicRoutes, { prefix: '/s' });
    await web.register(twoFactorRoutes, { prefix: '/2fa' });
    await web.register(accountRoutes, { prefix: '/account' });
    await web.register(versionRoutes, { prefix: '/version' });
    await web.register(adminRoutes, { prefix: '/admin' });
    await web.register(apiV1Routes, { prefix: '/api/v1' });
  });

  app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
    req.log.error({ err }, 'request failed');
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({
      error: status === 500 ? 'Internal server error' : (err.message ?? 'Error'),
    });
  });

  return app;
}
