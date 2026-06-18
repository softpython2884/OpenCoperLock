/**
 * Quick-Upload: a public, code-gated drop zone usable from any device without a full
 * login. Files are server-side encrypted and antivirus-scanned, counted against the
 * code creator's quota, and dropped into the code's target folder. ZK folders cannot
 * be quick-upload targets (a guest has no vault key).
 *
 * This is the only unauthenticated write path, so it is deliberately constrained:
 * per-code expiry, usage limit, optional password, and size cap.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { Readable } from 'node:stream';
import { prisma } from '../db.js';
import { newStorageKey } from '../storage/index.js';
import { verifyPassword } from '../services/password.js';
import {
  FileTooLargeError,
  InfectedFileError,
  ingestPlaintext,
} from '../services/ingest.js';
import { adjustUsage, remainingAllowance } from '../services/quota.js';
import { audit } from '../services/audit.js';

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

function isUsedUp(usageLimit: number | null, usageCount: number): boolean {
  return usageLimit !== null && usageCount >= usageLimit;
}

export const quickRoutes: FastifyPluginAsync = async (app) => {
  // GET /quick/:code — lightweight validity probe for the guest UI.
  app.get('/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const entry = await prisma.quickUploadCode.findUnique({ where: { code } });
    if (!entry || isExpired(entry.expiresAt) || isUsedUp(entry.usageLimit, entry.usageCount)) {
      return reply.code(404).send({ error: 'Code not found or no longer active' });
    }
    return { valid: true, requiresPassword: entry.passwordHash !== null };
  });

  // POST /quick/:code — guest upload. Send an optional `password` field, then the file.
  app.post('/:code', async (req, reply) => {
    const { code } = req.params as { code: string };
    const entry = await prisma.quickUploadCode.findUnique({ where: { code } });
    if (!entry || isExpired(entry.expiresAt) || isUsedUp(entry.usageLimit, entry.usageCount)) {
      return reply.code(404).send({ error: 'Code not found or no longer active' });
    }

    let password: string | undefined;
    let filePart: { file: Readable; filename: string; mimetype: string } | undefined;
    for await (const part of req.parts()) {
      if (part.type === 'field' && part.fieldname === 'password') {
        password = String(part.value);
      } else if (part.type === 'file') {
        filePart = { file: part.file, filename: part.filename, mimetype: part.mimetype };
        break;
      }
    }

    if (entry.passwordHash) {
      const ok = password ? await verifyPassword(entry.passwordHash, password) : false;
      if (!ok) {
        // Drain any file stream we already started consuming.
        filePart?.file.resume();
        return reply.code(401).send({ error: 'Incorrect code password' });
      }
    }
    if (!filePart) return reply.code(400).send({ error: 'No file provided' });

    if (entry.targetFolderId) {
      const folder = await prisma.folder.findUnique({ where: { id: entry.targetFolderId } });
      if (folder?.isZeroKnowledge) {
        filePart.file.resume();
        return reply.code(400).send({ error: 'Target folder cannot be a vault' });
      }
    }

    const ownerId = entry.createdById;
    const ownerAllowance = await remainingAllowance(ownerId);
    const maxBytes = Math.min(
      ownerAllowance,
      entry.maxBytes === null ? Infinity : Number(entry.maxBytes),
    );
    if (maxBytes <= 0) return reply.code(413).send({ error: 'Destination is out of space' });

    const storageKey = newStorageKey();
    try {
      const result = await ingestPlaintext(app.ctx, filePart.file, { maxBytes, storageKey });
      const file = await prisma.fileObject.create({
        data: {
          ownerId,
          folderId: entry.targetFolderId,
          name: filePart.filename,
          sizeBytes: BigInt(result.sizeBytes),
          mimeType: filePart.mimetype,
          storageKey: result.storageKey,
          encMode: 'SERVER',
          wrappedKey: result.wrappedKey,
          iv: result.iv,
          authTag: result.authTag,
          sha256: result.sha256,
          avStatus: result.avStatus,
        },
      });
      await adjustUsage(ownerId, result.sizeBytes);
      await prisma.quickUploadCode.update({
        where: { id: entry.id },
        data: { usageCount: { increment: 1 } },
      });
      await audit(req, 'quick.upload', { actorId: null, target: file.id });
      return reply.code(201).send({ ok: true, fileId: file.id });
    } catch (err) {
      await app.ctx.storage.delete(storageKey).catch(() => {});
      if (err instanceof FileTooLargeError) {
        return reply.code(413).send({ error: 'File too large for this drop zone' });
      }
      if (err instanceof InfectedFileError) {
        return reply.code(422).send({ error: `File rejected: ${err.signature}`, code: 'INFECTED' });
      }
      throw err;
    }
  });
};
