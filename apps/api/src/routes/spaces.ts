/**
 * Shared Spaces API. A space is owned by one user (who pays for its storage) and shared with a
 * group of members who are EDITOR (read/write) or VIEWER (read-only). Content is ordinary
 * SERVER-encrypted folders/files tagged with the space id; every request is gated by
 * `getSpaceAccess` instead of the personal Drive's `ownerId === me` filter.
 *
 * Zero-Knowledge is intentionally unavailable here: sharing requires the server to decrypt for
 * each authorized member, which is impossible for blind ZK content.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  addSpaceMemberSchema,
  createFolderSchema,
  createSpaceSchema,
  DELETE_SPACE_MODES,
  updateFileSchema,
  updateFolderSchema,
  updateSpaceMemberSchema,
  updateSpaceSchema,
  type DeleteSpaceMode,
  type PublicSpace,
  type PublicSpaceMember,
} from '@opencoperlock/shared';
import type { SharedSpace } from '@prisma/client';
import { prisma } from '../db.js';
import { parseOr400 } from '../lib/validate.js';
import { toPublicFile, toPublicFolder } from '../lib/serialize.js';
import { audit } from '../services/audit.js';
import {
  canWrite,
  deleteSpaceCascade,
  getSpaceAccess,
  purgeSpaceFile,
  purgeSpaceFolder,
  spaceFolderIds,
  spaceUsedBytes,
  transferSpaceToEarliestMember,
  type SpaceAccess,
} from '../services/spaces.js';
import { storeUserFile, QuotaExhaustedError } from '../services/upload.js';
import { decryptServerFile } from '../services/download.js';
import { FileTooLargeError, InfectedFileError } from '../services/ingest.js';

export const spaceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // ── Access helpers ─────────────────────────────────────────────────────────

  /** Resolve the caller's access to :id, or reply 404 (no leak of existence) / 403 and return null. */
  async function access(
    req: FastifyRequest,
    reply: FastifyReply,
    write = false,
  ): Promise<SpaceAccess | null> {
    const { id } = req.params as { id: string };
    const acc = await getSpaceAccess(req.user!.id, id);
    if (!acc) {
      reply.code(404).send({ error: 'Space not found' });
      return null;
    }
    if (write && !canWrite(acc.role)) {
      reply.code(403).send({ error: 'You have read-only access to this space' });
      return null;
    }
    return acc;
  }

  async function ownerOnly(req: FastifyRequest, reply: FastifyReply): Promise<SpaceAccess | null> {
    const acc = await access(req, reply);
    if (!acc) return null;
    if (acc.role !== 'OWNER') {
      reply.code(403).send({ error: 'Only the space owner can do this' });
      return null;
    }
    return acc;
  }

  async function toPublicSpace(space: SharedSpace, myRole: PublicSpace['myRole']): Promise<PublicSpace> {
    const [owner, memberCount, usedBytes] = await Promise.all([
      prisma.user.findUnique({ where: { id: space.ownerId }, select: { email: true } }),
      prisma.sharedSpaceMember.count({ where: { spaceId: space.id } }),
      spaceUsedBytes(space.id),
    ]);
    return {
      id: space.id,
      name: space.name,
      myRole,
      ownerId: space.ownerId,
      ownerEmail: owner?.email ?? '',
      memberCount,
      usedBytes,
      createdAt: space.createdAt.toISOString(),
    };
  }

  async function listMembers(spaceId: string): Promise<PublicSpaceMember[]> {
    const members = await prisma.sharedSpaceMember.findMany({
      where: { spaceId },
      orderBy: { joinedAt: 'asc' },
      include: { user: { select: { email: true } } },
    });
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  /** A folder that belongs to this space (or null), used to validate parents/targets. */
  function folderInSpace(spaceId: string, folderId: string) {
    return prisma.folder.findFirst({ where: { id: folderId, spaceId } });
  }

  // ── Spaces ───────────────────────────────────────────────────────────────--

  // GET /spaces — every space the caller owns or belongs to.
  app.get('/', async (req) => {
    const userId = req.user!.id;
    const [owned, memberships] = await Promise.all([
      prisma.sharedSpace.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'desc' } }),
      prisma.sharedSpaceMember.findMany({
        where: { userId },
        orderBy: { joinedAt: 'desc' },
        include: { space: true },
      }),
    ]);
    const spaces = await Promise.all([
      ...owned.map((s) => toPublicSpace(s, 'OWNER')),
      ...memberships.map((m) => toPublicSpace(m.space, m.role)),
    ]);
    return { spaces };
  });

  // POST /spaces — create a space; the caller becomes its owner.
  app.post('/', async (req, reply) => {
    const body = parseOr400(reply, createSpaceSchema, req.body);
    if (!body) return;
    const space = await prisma.sharedSpace.create({
      data: { name: body.name, ownerId: req.user!.id },
    });
    await audit(req, 'space.create', { target: space.id });
    return reply.code(201).send({ space: await toPublicSpace(space, 'OWNER') });
  });

  // GET /spaces/:id — detail + members.
  app.get('/:id', async (req, reply) => {
    const acc = await access(req, reply);
    if (!acc) return;
    const [base, members] = await Promise.all([
      toPublicSpace(acc.space, acc.role),
      listMembers(acc.space.id),
    ]);
    return { space: { ...base, members } };
  });

  // PATCH /spaces/:id — rename (owner only).
  app.patch('/:id', async (req, reply) => {
    const acc = await ownerOnly(req, reply);
    if (!acc) return;
    const body = parseOr400(reply, updateSpaceSchema, req.body);
    if (!body) return;
    const space = await prisma.sharedSpace.update({ where: { id: acc.space.id }, data: { name: body.name } });
    await audit(req, 'space.update', { target: space.id });
    return { space: await toPublicSpace(space, 'OWNER') };
  });

  // DELETE /spaces/:id?mode=delete|transfer — owner only. `delete` wipes everything; `transfer`
  // hands the space (and its storage cost) to the earliest-joined member, falling back to delete
  // if there is no member to receive it.
  app.delete('/:id', async (req, reply) => {
    const acc = await ownerOnly(req, reply);
    if (!acc) return;
    const raw = (req.query as { mode?: string }).mode ?? 'delete';
    const mode = (DELETE_SPACE_MODES as readonly string[]).includes(raw)
      ? (raw as DeleteSpaceMode)
      : 'delete';

    if (mode === 'transfer') {
      const heir = await transferSpaceToEarliestMember(acc.space);
      if (heir) {
        await audit(req, 'space.transfer', { target: acc.space.id });
        return { ok: true, transferredTo: heir };
      }
      // No member to transfer to — fall through to a full delete.
    }
    await deleteSpaceCascade(app.ctx, acc.space);
    await audit(req, 'space.delete', { target: acc.space.id });
    return { ok: true, deleted: true };
  });

  // ── Members ────────────────────────────────────────────────────────────────

  // POST /spaces/:id/members — owner adds an existing instance user by email.
  app.post('/:id/members', async (req, reply) => {
    const acc = await ownerOnly(req, reply);
    if (!acc) return;
    const body = parseOr400(reply, addSpaceMemberSchema, req.body);
    if (!body) return;

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) return reply.code(404).send({ error: 'No account with that email on this instance' });
    if (user.id === acc.space.ownerId) {
      return reply.code(400).send({ error: 'The owner already has full access' });
    }
    const member = await prisma.sharedSpaceMember.upsert({
      where: { spaceId_userId: { spaceId: acc.space.id, userId: user.id } },
      create: { spaceId: acc.space.id, userId: user.id, role: body.role },
      update: { role: body.role },
      include: { user: { select: { email: true } } },
    });
    await audit(req, 'space.member.add', { target: acc.space.id });
    return reply.code(201).send({
      member: {
        userId: member.userId,
        email: member.user.email,
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
      } satisfies PublicSpaceMember,
    });
  });

  // PATCH /spaces/:id/members/:userId — change a member's role (owner only).
  app.patch('/:id/members/:userId', async (req, reply) => {
    const acc = await ownerOnly(req, reply);
    if (!acc) return;
    const { userId } = req.params as { userId: string };
    const body = parseOr400(reply, updateSpaceMemberSchema, req.body);
    if (!body) return;
    const existing = await prisma.sharedSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId: acc.space.id, userId } },
    });
    if (!existing) return reply.code(404).send({ error: 'Member not found' });
    await prisma.sharedSpaceMember.update({ where: { id: existing.id }, data: { role: body.role } });
    await audit(req, 'space.member.update', { target: acc.space.id });
    return { ok: true };
  });

  // DELETE /spaces/:id/members/:userId — owner removes a member, or a member removes themselves
  // (leaves the space). The owner can never be removed this way (they delete/transfer instead).
  app.delete('/:id/members/:userId', async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    const acc = await getSpaceAccess(req.user!.id, id);
    if (!acc) return reply.code(404).send({ error: 'Space not found' });
    const isOwner = acc.role === 'OWNER';
    const isSelf = req.user!.id === userId;
    if (!isOwner && !isSelf) {
      return reply.code(403).send({ error: 'Only the owner can remove other members' });
    }
    if (userId === acc.space.ownerId) {
      return reply.code(400).send({ error: 'The owner cannot leave; delete or transfer the space instead' });
    }
    const existing = await prisma.sharedSpaceMember.findUnique({
      where: { spaceId_userId: { spaceId: id, userId } },
    });
    if (!existing) return reply.code(404).send({ error: 'Member not found' });
    await prisma.sharedSpaceMember.delete({ where: { id: existing.id } });
    await audit(req, isSelf ? 'space.member.leave' : 'space.member.remove', { target: id });
    return { ok: true };
  });

  // ── Folders ────────────────────────────────────────────────────────────────

  // GET /spaces/:id/folders — flat list of the space's folders.
  app.get('/:id/folders', async (req, reply) => {
    const acc = await access(req, reply);
    if (!acc) return;
    const folders = await prisma.folder.findMany({
      where: { spaceId: acc.space.id },
      orderBy: { name: 'asc' },
    });
    return { folders: folders.map(toPublicFolder) };
  });

  // POST /spaces/:id/folders — create a folder (editor+). ZK is forced off.
  app.post('/:id/folders', async (req, reply) => {
    const acc = await access(req, reply, true);
    if (!acc) return;
    const body = parseOr400(reply, createFolderSchema, req.body);
    if (!body) return;
    if (body.parentId) {
      const parent = await folderInSpace(acc.space.id, body.parentId);
      if (!parent) return reply.code(404).send({ error: 'Parent folder not found' });
    }
    try {
      const folder = await prisma.folder.create({
        data: {
          ownerId: acc.space.ownerId,
          spaceId: acc.space.id,
          parentId: body.parentId ?? null,
          name: body.name,
          isZeroKnowledge: false,
        },
      });
      await audit(req, 'space.folder.create', { target: folder.id });
      return reply.code(201).send({ folder: toPublicFolder(folder) });
    } catch {
      return reply.code(409).send({ error: 'A folder with that name already exists here' });
    }
  });

  // PATCH /spaces/:id/folders/:folderId — rename and/or move within the space (editor+).
  app.patch('/:id/folders/:folderId', async (req, reply) => {
    const acc = await access(req, reply, true);
    if (!acc) return;
    const { folderId } = req.params as { folderId: string };
    const body = parseOr400(reply, updateFolderSchema, req.body);
    if (!body) return;
    const folder = await folderInSpace(acc.space.id, folderId);
    if (!folder) return reply.code(404).send({ error: 'Folder not found' });

    if (body.parentId !== undefined && body.parentId !== null) {
      if (body.parentId === folderId) return reply.code(400).send({ error: 'A folder cannot contain itself' });
      const target = await folderInSpace(acc.space.id, body.parentId);
      if (!target) return reply.code(404).send({ error: 'Target folder not found' });
      const subtree = await spaceFolderIds(acc.space.id, folderId);
      if (subtree.includes(body.parentId)) {
        return reply.code(400).send({ error: 'Cannot move a folder into its own subtree' });
      }
    }
    try {
      const updated = await prisma.folder.update({
        where: { id: folderId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        },
      });
      await audit(req, 'space.folder.update', { target: folderId });
      return { folder: toPublicFolder(updated) };
    } catch {
      return reply.code(409).send({ error: 'A folder with that name already exists there' });
    }
  });

  // DELETE /spaces/:id/folders/:folderId — permanently delete the folder subtree (editor+).
  app.delete('/:id/folders/:folderId', async (req, reply) => {
    const acc = await access(req, reply, true);
    if (!acc) return;
    const { folderId } = req.params as { folderId: string };
    const ok = await purgeSpaceFolder(app.ctx, acc.space, folderId);
    if (!ok) return reply.code(404).send({ error: 'Folder not found' });
    await audit(req, 'space.folder.delete', { target: folderId });
    return { ok: true };
  });

  // ── Files ──────────────────────────────────────────────────────────────────

  // GET /spaces/:id/files?folderId= — list files in a space folder (or the space root).
  app.get('/:id/files', async (req, reply) => {
    const acc = await access(req, reply);
    if (!acc) return;
    const { folderId } = req.query as { folderId?: string };
    const files = await prisma.fileObject.findMany({
      where: { spaceId: acc.space.id, folderId: folderId ?? null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { files: files.map(toPublicFile) };
  });

  // POST /spaces/:id/files?folderId= — upload (editor+). Billed to the OWNER's quota.
  app.post('/:id/files', async (req, reply) => {
    const acc = await access(req, reply, true);
    if (!acc) return;
    const { folderId } = req.query as { folderId?: string };
    if (folderId) {
      const folder = await folderInSpace(acc.space.id, folderId);
      if (!folder) return reply.code(404).send({ error: 'Folder not found' });
    }
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'No file provided' });
    try {
      const { file } = await storeUserFile(app.ctx, {
        ownerId: acc.space.ownerId,
        spaceId: acc.space.id,
        folderId: folderId ?? null,
        stream: part.file,
        filename: part.filename,
        mimetype: part.mimetype,
      });
      await audit(req, 'space.file.upload', { target: file.id });
      return reply.code(201).send({ file: toPublicFile(file) });
    } catch (err) {
      if (err instanceof QuotaExhaustedError || err instanceof FileTooLargeError) {
        return reply.code(413).send({ error: "The space owner's storage quota is exhausted" });
      }
      if (err instanceof InfectedFileError) {
        await audit(req, 'space.file.infected', { target: err.signature });
        return reply.code(422).send({ error: `File rejected: ${err.signature}`, code: 'INFECTED' });
      }
      throw err;
    }
  });

  // GET /spaces/:id/files/:fileId/download — decrypt and stream (any member).
  app.get('/:id/files/:fileId/download', async (req, reply) => {
    const acc = await access(req, reply);
    if (!acc) return;
    const { fileId } = req.params as { fileId: string };
    const file = await prisma.fileObject.findFirst({
      where: { id: fileId, spaceId: acc.space.id, deletedAt: null },
    });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    await audit(req, 'space.file.download', { target: file.id });
    reply
      .header('Content-Type', file.mimeType)
      .header('Content-Length', Number(file.sizeBytes))
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    return reply.send(decryptServerFile(app.ctx, file));
  });

  // PATCH /spaces/:id/files/:fileId — rename and/or move within the space (editor+).
  app.patch('/:id/files/:fileId', async (req, reply) => {
    const acc = await access(req, reply, true);
    if (!acc) return;
    const { fileId } = req.params as { fileId: string };
    const body = parseOr400(reply, updateFileSchema, req.body);
    if (!body) return;
    const file = await prisma.fileObject.findFirst({ where: { id: fileId, spaceId: acc.space.id } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (body.folderId !== undefined && body.folderId !== null) {
      const folder = await folderInSpace(acc.space.id, body.folderId);
      if (!folder) return reply.code(404).send({ error: 'Target folder not found' });
    }
    const updated = await prisma.fileObject.update({
      where: { id: fileId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.folderId !== undefined ? { folderId: body.folderId } : {}),
      },
    });
    await audit(req, 'space.file.update', { target: fileId });
    return { file: toPublicFile(updated) };
  });

  // DELETE /spaces/:id/files/:fileId — permanently delete the file (editor+).
  app.delete('/:id/files/:fileId', async (req, reply) => {
    const acc = await access(req, reply, true);
    if (!acc) return;
    const { fileId } = req.params as { fileId: string };
    const ok = await purgeSpaceFile(app.ctx, acc.space, fileId);
    if (!ok) return reply.code(404).send({ error: 'File not found' });
    await audit(req, 'space.file.delete', { target: fileId });
    return { ok: true };
  });
};
