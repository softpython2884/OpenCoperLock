/**
 * Trash management: list soft-deleted items, restore them, or permanently purge them.
 * Deleting a file/folder elsewhere moves it here (see services/trash.ts); this is where it
 * comes back from — or is destroyed for good.
 */
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import {
  emptyTrash,
  listTrash,
  purgeFile,
  purgeFolder,
  restoreFile,
  restoreFolder,
} from '../services/trash.js';
import { audit } from '../services/audit.js';

export const trashRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /trash — the Trash "roots" (items deleted directly, newest first).
  app.get('/', async (req) => {
    return { entries: await listTrash(req.user!.id) };
  });

  // POST /trash/files/:id/restore
  app.post('/files/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await restoreFile(req.user!.id, id))) return reply.code(404).send({ error: 'Item not found in Trash' });
    await audit(req, 'trash.restore', { target: id });
    return { ok: true };
  });

  // POST /trash/folders/:id/restore
  app.post('/folders/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await restoreFolder(req.user!.id, id))) return reply.code(404).send({ error: 'Item not found in Trash' });
    await audit(req, 'trash.restore', { target: id });
    return { ok: true };
  });

  // DELETE /trash/files/:id — purge permanently.
  app.delete('/files/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await purgeFile(app.ctx, req.user!.id, id))) return reply.code(404).send({ error: 'Item not found in Trash' });
    await audit(req, 'trash.purge', { target: id });
    return { ok: true };
  });

  // DELETE /trash/folders/:id — purge permanently (whole subtree).
  app.delete('/folders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await purgeFolder(app.ctx, req.user!.id, id))) return reply.code(404).send({ error: 'Item not found in Trash' });
    await audit(req, 'trash.purge', { target: id });
    return { ok: true };
  });

  // POST /trash/empty — purge everything in the user's Trash.
  app.post('/empty', async (req) => {
    await emptyTrash(app.ctx, req.user!.id);
    await audit(req, 'trash.empty');
    // Surface the freed-up running total so the client can refresh the storage gauge.
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { usedBytes: true } });
    return { ok: true, usedBytes: Number(user?.usedBytes ?? 0) };
  });
};
