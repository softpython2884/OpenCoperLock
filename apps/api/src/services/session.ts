/**
 * Server-side sessions. A session row holds a per-session `csrfSecret`; the signed,
 * httpOnly cookie carries only the opaque session id. The CSRF token handed to the
 * SPA equals that secret — a classic double-submit guard: an attacker on another
 * origin can neither read the httpOnly cookie nor set our custom CSRF header.
 */
import { randomToken } from '@opencoperlock/shared';
import { prisma } from '../db.js';

/** Sessions live 30 days unless explicitly destroyed. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionWithUser {
  id: string;
  csrfSecret: string;
  user: {
    id: string;
    email: string;
    role: 'ADMIN' | 'USER';
    disabled: boolean;
  };
}

export async function createSession(
  userId: string,
): Promise<{ id: string; csrfSecret: string; expiresAt: Date }> {
  const csrfSecret = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: { userId, csrfSecret, expiresAt },
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
  return { id: session.id, csrfSecret: session.csrfSecret, user: session.user };
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}
