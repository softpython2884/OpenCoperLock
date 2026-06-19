/**
 * Server-side sessions. A session row holds a per-session `csrfSecret`; the signed,
 * httpOnly cookie carries only the opaque session id. The CSRF token handed to the
 * SPA equals that secret — a classic double-submit guard: an attacker on another
 * origin can neither read the httpOnly cookie nor set our custom CSRF header.
 *
 * Sessions also record the login IP and user-agent and a rolling `lastSeenAt`, so a user
 * can review and revoke their active sessions.
 */
import { randomToken } from '@opencoperlock/shared';
import { prisma } from '../db.js';

/** Sessions live 30 days unless explicitly destroyed. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Only refresh lastSeenAt at most this often, to avoid a write per request. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export interface SessionWithUser {
  id: string;
  csrfSecret: string;
  lastSeenAt: Date;
  user: {
    id: string;
    email: string;
    role: 'ADMIN' | 'USER';
    disabled: boolean;
  };
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string; csrfSecret: string; expiresAt: Date }> {
  const csrfSecret = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: {
      userId,
      csrfSecret,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });
  return { id: session.id, csrfSecret, expiresAt };
}

/** Load a live session + its user, or null if missing/expired. Expired rows are reaped. */
export async function getSession(sessionId: string): Promise<SessionWithUser | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { select: { id: true, email: true, role: true, disabled: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return {
    id: session.id,
    csrfSecret: session.csrfSecret,
    lastSeenAt: session.lastSeenAt,
    user: session.user,
  };
}

/** Refresh lastSeenAt, but no more than once per throttle window. */
export async function touchSession(sessionId: string, lastSeenAt: Date): Promise<void> {
  if (Date.now() - lastSeenAt.getTime() < LAST_SEEN_THROTTLE_MS) return;
  await prisma.session
    .update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}
