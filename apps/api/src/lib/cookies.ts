import type { FastifyReply } from 'fastify';
import { SESSION_COOKIE } from '@opencoperlock/shared';

/** Cookie attributes shared by set & clear so they always match. */
function baseOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    signed: true,
  };
}

export function setSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  expiresAt: Date,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE, sessionId, { ...baseOptions(secure), expires: expiresAt });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, baseOptions(secure));
}
