/**
 * Personal API tokens for the public REST API. The token is `ocl_<random>`; only its SHA-256
 * hash is persisted, so a database leak never yields a usable credential. Authentication is by
 * `Authorization: Bearer …` — there is no cookie, so this path is not subject to CSRF.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../db.js';

const PREFIX = 'ocl_';
const TOUCH_INTERVAL_MS = 60_000;

export type ApiScope = 'read' | 'write';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A fresh token: the plaintext (shown once), its stored hash, and a non-secret display prefix. */
export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `${PREFIX}${randomBytes(24).toString('base64url')}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

export interface AuthedToken {
  id: string;
  ownerId: string;
  scopes: string[];
  folderId: string | null;
}
export interface TokenOwner {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
  disabled: boolean;
}

export type TokenAuthResult =
  | { ok: true; token: AuthedToken; owner: TokenOwner }
  | { ok: false; status: number; error: string };

/** Validate a Bearer token for a required scope, returning the owner principal on success. */
export async function authenticateToken(
  authorization: string | undefined,
  requiredScope: ApiScope,
): Promise<TokenAuthResult> {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing bearer token' };
  }
  const raw = authorization.slice('Bearer '.length).trim();
  if (!raw.startsWith(PREFIX)) return { ok: false, status: 401, error: 'Invalid token' };

  const row = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { owner: true } });
  if (!row) return { ok: false, status: 401, error: 'Invalid token' };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return { ok: false, status: 401, error: 'Token expired' };
  if (row.owner.disabled) return { ok: false, status: 403, error: 'Account disabled' };

  const scopes = row.scopes.split(',').filter(Boolean);
  if (!scopes.includes(requiredScope)) {
    return { ok: false, status: 403, error: `Token is missing the '${requiredScope}' scope` };
  }

  void touchLastUsed(row.id, row.lastUsedAt);
  return {
    ok: true,
    token: { id: row.id, ownerId: row.ownerId, scopes, folderId: row.folderId },
    owner: { id: row.owner.id, email: row.owner.email, role: row.owner.role, disabled: row.owner.disabled },
  };
}

/** Throttled `lastUsedAt` bump so a busy token isn't written on every request. */
async function touchLastUsed(id: string, last: Date | null): Promise<void> {
  if (last && Date.now() - last.getTime() < TOUCH_INTERVAL_MS) return;
  await prisma.apiToken.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => {});
}
