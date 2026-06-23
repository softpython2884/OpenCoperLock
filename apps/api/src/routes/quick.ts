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
import { QUICK_THROTTLE } from '@opencoperlock/shared';
import { prisma } from '../db.js';
import { newStorageKey } from '../storage/index.js';
import { verifyPassword } from '../services/password.js';
import {
  FileTooLargeError,
  InfectedFileError,
  ingestPlaintext,
} from '../services/ingest.js';
import { adjustUsage, remainingAllowance } from '../services/quota.js';
import { checkLock, clearFailures, recordFailure } from '../services/throttle.js';
import { ensureFastUploadFolder } from '../services/systemFolders.js';
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
    // Throttle blind enumeration per IP, and NEVER reveal whether a code exists: an invalid,
    // expired or used-up code returns the same generic "access denied" as any other.
    const ipKey = `probe:${req.ip}`;
    const lock = await checkLock('quick', ipKey);
    if (lock.locked) {
      reply.header('Retry-After', String(lock.retryAfterSec));
      return reply.code(429).send({ error: 'Too many attempts. Try again later.', code: 'LOCKED' });
    }
    const code = String((req.params as { code: string }).code).toUpperCase();
    const entry = await prisma.quickUploadCode.findUnique({ where: { code } });
    if (!entry || isExpired(entry.expiresAt) || isUsedUp(entry.usageLimit, entry.usageCount)) {
      await recordFailure('quick', ipKey, QUICK_THROTTLE);
      return reply.code(403).send({ error: 'Access denied', code: 'UNAUTHORIZED' });
    }
    await clearFailures('quick', ipKey);
    return { valid: true, requiresPassword: entry.passwordHash !== null };
  });

  // POST /quick/:code — guest upload. Send an optional `password` field, then the file.
  // Per-IP rate limit guards the endpoint; a per-(code,IP) ban guards the password itself.
  const quickOpts = app.ctx.env.RATE_LIMIT_ENABLED
    ? { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }
    : {};
  app.post('/:code', quickOpts, async (req, reply) => {
      const code = String((req.params as { code: string }).code).toUpperCase();
      const entry = await prisma.quickUploadCode.findUnique({ where: { code } });
      if (!entry || isExpired(entry.expiresAt) || isUsedUp(entry.usageLimit, entry.usageCount)) {
        // Same generic response as the probe — no enumeration oracle, throttled per IP.
        await recordFailure('quick', `probe:${req.ip}`, QUICK_THROTTLE);
        return reply.code(403).send({ error: 'Access denied', code: 'UNAUTHORIZED' });
      }

      // Ban an IP that keeps guessing this code's password. Keyed per (code, IP) so one
      // guest's mistakes never affect another, and a correct password isn't penalised.
      const throttleKey = `${code}:${req.ip}`;
      const lock = await checkLock('quick', throttleKey);
      if (lock.locked) {
        reply.header('Retry-After', String(lock.retryAfterSec));
        return reply.code(429).send({ error: 'Too many attempts. Try again later.', code: 'LOCKED' });
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
          filePart?.file.resume(); // drain any file stream we already started consuming
          const after = await recordFailure('quick', throttleKey, QUICK_THROTTLE);
          if (after.locked) reply.header('Retry-After', String(after.retryAfterSec));
          return reply.code(401).send({ error: 'Incorrect code password' });
        }
        await clearFailures('quick', throttleKey);
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
    // No explicit target → drop into the owner's Fast-Upload folder, so every code upload
    // lands somewhere predictable instead of the account root.
    const targetFolderId = entry.targetFolderId ?? (await ensureFastUploadFolder(ownerId));
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
          folderId: targetFolderId,
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
