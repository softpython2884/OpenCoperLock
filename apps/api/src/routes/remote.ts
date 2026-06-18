import type { FastifyPluginAsync } from 'fastify';
import { assertAllowedUrl, remoteUploadSchema, SsrfError } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { toPublicRemoteJob } from '../lib/serialize.js';
import { audit } from '../services/audit.js';

export const remoteRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /remote — the user's recent jobs.
  app.get('/', async (req) => {
    const jobs = await prisma.remoteUploadJob.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { jobs: jobs.map(toPublicRemoteJob) };
  });

  // POST /remote — enqueue a server-side download. The worker loop does the work.
  app.post('/', async (req, reply) => {
    const body = parseOr400(reply, remoteUploadSchema, req.body);
    if (!body) return;

    // Fail fast on obviously disallowed URLs (the worker re-checks at fetch time).
    try {
      assertAllowedUrl(body.sourceUrl);
    } catch (err) {
      if (err instanceof SsrfError) return reply.code(400).send({ error: err.message });
      throw err;
    }

    if (body.folderId) {
      const folder = await prisma.folder.findFirst({
        where: { id: body.folderId, ownerId: req.user!.id },
      });
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
      if (folder.isZeroKnowledge) {
        return reply.code(400).send({ error: 'Remote-Upload cannot target a vault folder' });
      }
    }

    const job = await prisma.remoteUploadJob.create({
      data: { ownerId: req.user!.id, sourceUrl: body.sourceUrl, folderId: body.folderId ?? null },
    });
    await audit(req, 'remote.enqueue', { target: job.id });
    return reply.code(202).send({ job: toPublicRemoteJob(job) });
  });

  // GET /remote/:id — poll a single job.
  app.get('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.remoteUploadJob.findFirst({
      where: { id, ownerId: req.user!.id },
    });
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return { job: toPublicRemoteJob(job) };
  });
};
