/**
 * Integration-test helpers: build a real Fastify app against the test database, reset
 * state between tests, and drive auth + multipart uploads through `app.inject`.
 */
import FormData from 'form-data';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/env.js';
import { createContext } from '../src/context.js';
import { buildServer } from '../src/server.js';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/services/password.js';

export async function buildTestApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = await buildServer(createContext(env));
  await app.ready();
  return app;
}

/** Truncate every table so each test starts from a clean slate. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User","Session","Folder","FileObject","QuickUploadCode","RemoteUploadJob","AuditLog","Throttle","Setting" RESTART IDENTITY CASCADE',
  );
}

export async function createUser(opts: {
  email: string;
  password: string;
  role?: 'ADMIN' | 'USER';
  quotaBytes?: bigint | null;
}) {
  return prisma.user.create({
    data: {
      email: opts.email,
      passwordHash: await hashPassword(opts.password),
      role: opts.role ?? 'USER',
      quotaBytes: opts.quotaBytes ?? 10n * 1024n ** 3n,
    },
  });
}

export interface Auth {
  cookie: string;
  csrf: string;
}

/** Log in and return the cookie + CSRF token for authenticated requests. */
export async function login(app: FastifyInstance, email: string, password: string): Promise<Auth> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'ocl_session');
  if (!cookie) throw new Error('no session cookie returned');
  return { cookie: `${cookie.name}=${cookie.value}`, csrf: res.json().csrfToken as string };
}

/** Headers for an authenticated mutating request. */
export function authHeaders(auth: Auth): Record<string, string> {
  return { cookie: auth.cookie, 'x-ocl-csrf': auth.csrf };
}

/** Upload a file via multipart to a route, returning the inject response. */
export async function uploadFile(
  app: FastifyInstance,
  url: string,
  auth: Auth,
  filename: string,
  contents: Buffer,
) {
  const form = new FormData();
  form.append('file', contents, { filename, contentType: 'application/octet-stream' });
  return app.inject({
    method: 'POST',
    url,
    payload: form.getBuffer(),
    headers: { ...form.getHeaders(), ...authHeaders(auth) },
  });
}
