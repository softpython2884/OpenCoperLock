import type { FastifyPluginAsync } from 'fastify';
import { createFolderSchema, randomToken, updateFolderSchema } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { toPublicFolder } from '../lib/serialize.js';
import { trashFolder } from '../services/trash.js';
import { audit } from '../services/audit.js';

/** Collect a folder's id plus all descendant ids (breadth-first), scoped to one owner's personal
 *  Drive (Shared-Space folders carry a spaceId and are handled by the /spaces routes). */
async function collectSubtree(rootId: string, ownerId: string): Promise<string[]> {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i += 1) {
    const children = await prisma.folder.findMany({
      where: { parentId: ids[i], ownerId, spaceId: null },
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
      where: { ownerId: req.user!.id, spaceId: null, deletedAt: null },
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
        where: { id: body.parentId, ownerId: req.user!.id, spaceId: null },
      });
      if (!parent) return reply.code(404).send({ error: 'Parent folder not found' });
    }

    const isZk = body.isZeroKnowledge ?? false;
    try {
      const folder = await prisma.folder.create({
        data: {
          ownerId: req.user!.id,
          parentId: body.parentId ?? null,
          name: body.name,
          isZeroKnowledge: isZk,
          // Per-vault salt: prefer the client's (so it can derive the key before the round-trip),
          // else a fresh server one. Independent per vault either way.
          zkSalt: isZk ? (body.zkSalt ?? randomToken(16)) : null,
          // Passphrase verifier supplied by the client (so unlock can detect a wrong passphrase).
          zkVerifier: isZk ? (body.zkVerifier ?? null) : null,
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

    const folder = await prisma.folder.findFirst({ where: { id, ownerId: req.user!.id, spaceId: null } });
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });

    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === id) return reply.code(400).send({ error: 'A folder cannot contain itself' });
      const target = await prisma.folder.findFirst({
        where: { id: body.parentId, ownerId: req.user!.id, spaceId: null },
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

  // DELETE /folders/:id — move the folder (and its whole subtree) to the Trash. Nothing is
  // destroyed and no quota is released until it is purged from the Trash.
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await trashFolder(req.user!.id, id);
    if (!ok) return reply.code(404).send({ error: 'Folder not found' });
    await audit(req, 'folder.trash', { target: id });
    return { ok: true };
  });
};
