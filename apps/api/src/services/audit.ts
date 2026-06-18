import type { FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

/**
 * Append an audit-log entry. Best-effort: auditing must never break the request it
 * is recording, so failures are swallowed (and logged by the caller's logger).
 */
export async function audit(
  req: FastifyRequest,
  action: string,
  opts: { actorId?: string | null; target?: string | null } = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: opts.actorId ?? req.user?.id ?? null,
        action,
        target: opts.target ?? null,
        ip: req.ip,
      },
    });
  } catch (err) {
    req.log.warn({ err }, 'failed to write audit log');
  }
}
