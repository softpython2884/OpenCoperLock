import type { FastifyPluginAsync } from 'fastify';
import { createFolderSchema, updateFolderSchema } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { toPublicFolder } from '../lib/serialize.js';
import { adjustUsage } from '../services/quota.js';
import { audit } from '../services/audit.js';

/** Collect a folder's id plus all descendant ids (breadth-first), scoped to one owner. */
async function collectSubtree(rootId: string, ownerId: string): Promise<string[]> {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i += 1) {
    const children = await prisma.folder.findMany({
      where: { parentId: ids[i], ownerId },
      select: { id: true },
    });
    ids.push(...children.map((c) => c.id));
  }
  return ids;
}

export const folderRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /folders — flat list of the user's folders (the SPA assembles the tree).
  app.get('/', async (req) => {
    const folders = await prisma.folder.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { name: 'asc' },
    });
    return { folders: folders.map(toPublicFolder) };
  });

  // POST /folders — create a folder, optionally a Zero-Knowledge vault.
  app.post('/', async (req, reply) => {
    const body = parseOr400(reply, createFolderSchema, req.body);
    if (!body) return;

    if (body.parentId) {
      const parent = await prisma.folder.findFirst({
        where: { id: body.parentId, ownerId: req.user!.id },
      });
      if (!parent) return reply.code(404).send({ error: 'Parent folder not found' });
    }

    try {
      const folder = await prisma.folder.create({
        data: {
          ownerId: req.user!.id,
          parentId: body.parentId ?? null,
          name: body.name,
          isZeroKnowledge: body.isZeroKnowledge ?? false,
        },
      });
      await audit(req, 'folder.create', { target: folder.id });
      return reply.code(201).send({ folder: toPublicFolder(folder) });
    } catch {
      return reply.code(409).send({ error: 'A folder with that name already exists here' });
    }
  });

  // PATCH /folders/:id — rename and/or move a folder (with cycle protection).
  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(reply, updateFolderSchema, req.body);
    if (!body) return;

    const folder = await prisma.folder.findFirst({ where: { id, ownerId: req.user!.id } });
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });

    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === id) return reply.code(400).send({ error: 'A folder cannot contain itself' });
      const target = await prisma.folder.findFirst({
        where: { id: body.parentId, ownerId: req.user!.id },
      });
      if (!target) return reply.code(404).send({ error: 'Target folder not found' });
      // Reject moving a folder into one of its own descendants.
      const subtree = await collectSubtree(id, req.user!.id);
      if (subtree.includes(body.parentId)) {
        return reply.code(400).send({ error: 'Cannot move a folder into its own subtree' });
      }
    }

    try {
      const updated = await prisma.folder.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        },
      });
      await audit(req, 'folder.update', { target: id });
      return { folder: toPublicFolder(updated) };
    } catch {
      return reply.code(409).send({ error: 'A folder with that name already exists there' });
    }
  });

  // DELETE /folders/:id — recursively delete the folder, its subfolders and files,
  // releasing storage blobs and quota.
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const root = await prisma.folder.findFirst({ where: { id, ownerId: req.user!.id } });
    if (!root) return reply.code(404).send({ error: 'Folder not found' });

    const ids = await collectSubtree(root.id, req.user!.id);
    const files = await prisma.fileObject.findMany({ where: { folderId: { in: ids } } });
    let freed = 0;
    for (const file of files) {
      await app.ctx.storage.delete(file.storageKey).catch((err) => req.log.warn({ err }, 'blob delete failed'));
      freed += Number(file.sizeBytes);
    }
    await prisma.fileObject.deleteMany({ where: { folderId: { in: ids } } });
    if (freed > 0) await adjustUsage(req.user!.id, -freed);
    // Deleting the root cascades the subfolder rows (FolderChildren onDelete: Cascade).
    await prisma.folder.delete({ where: { id: root.id } });

    await audit(req, 'folder.delete', { target: root.id });
    return { ok: true, freedBytes: freed };
  });
};
