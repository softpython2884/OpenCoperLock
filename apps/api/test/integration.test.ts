import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { authHeaders, buildTestApp, createUser, login, resetDb, uploadFile } from './helpers.js';

// Integration tests require a database. Without one they skip so unit tests still run.
const runIf = process.env.DATABASE_URL ? describe : describe.skip;

runIf('API integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb();
  });

  describe('auth + login throttle', () => {
    it('rejects bad credentials then locks the account after repeated failures', async () => {
      await createUser({ email: 'a@test.local', password: 'correct-horse-battery' });

      // 5 wrong attempts are allowed (401); the 6th is locked out (429).
      for (let i = 0; i < 5; i += 1) {
        const res = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email: 'a@test.local', password: 'wrong' },
        });
        expect(res.statusCode).toBe(401);
      }
      const locked = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'a@test.local', password: 'wrong' },
      });
      expect(locked.statusCode).toBe(429);
      expect(locked.json().code).toBe('LOCKED');
      // Even the *correct* password is refused while locked.
      const stillLocked = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'a@test.local', password: 'correct-horse-battery' },
      });
      expect(stillLocked.statusCode).toBe(429);
    });

    it('logs in with correct credentials and clears the counter', async () => {
      await createUser({ email: 'b@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'b@test.local', 'correct-horse-battery');
      const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: auth.cookie } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.email).toBe('b@test.local');
    });

    it('enforces CSRF on mutations', async () => {
      await createUser({ email: 'c@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'c@test.local', 'correct-horse-battery');
      const noCsrf = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: { cookie: auth.cookie },
        payload: { name: 'docs' },
      });
      expect(noCsrf.statusCode).toBe(403);
    });
  });

  describe('files: upload, download, rename, move, delete', () => {
    it('round-trips an encrypted file and renames/moves it', async () => {
      const user = await createUser({ email: 'd@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'd@test.local', 'correct-horse-battery');
      const payload = Buffer.from('hello opencoperlock integration');

      const up = await uploadFile(app, '/files', auth, 'note.txt', payload);
      expect(up.statusCode).toBe(201);
      const fileId = up.json().file.id;

      // Usage was charged.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(Number(after.usedBytes)).toBe(payload.length);

      // Download returns the original bytes.
      const dl = await app.inject({
        method: 'GET',
        url: `/files/${fileId}/download`,
        headers: { cookie: auth.cookie },
      });
      expect(dl.statusCode).toBe(200);
      expect(Buffer.from(dl.rawPayload).equals(payload)).toBe(true);

      // Create a folder, then rename + move the file into it.
      const folder = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: authHeaders(auth),
        payload: { name: 'archive' },
      });
      const folderId = folder.json().folder.id;
      const patched = await app.inject({
        method: 'PATCH',
        url: `/files/${fileId}`,
        headers: authHeaders(auth),
        payload: { name: 'renamed.txt', folderId },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().file.name).toBe('renamed.txt');
      expect(patched.json().file.folderId).toBe(folderId);

      // Delete releases quota.
      const del = await app.inject({
        method: 'DELETE',
        url: `/files/${fileId}`,
        headers: authHeaders(auth),
      });
      expect(del.statusCode).toBe(200);
      const final = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(Number(final.usedBytes)).toBe(0);
    });

    it('rejects an upload that exceeds the quota', async () => {
      await createUser({ email: 'e@test.local', password: 'correct-horse-battery', quotaBytes: 8n });
      const auth = await login(app, 'e@test.local', 'correct-horse-battery');
      const res = await uploadFile(app, '/files', auth, 'big.bin', Buffer.alloc(64));
      expect(res.statusCode).toBe(413);
    });
  });

  describe('folders: rename, move, cycle protection', () => {
    it('prevents moving a folder into its own subtree', async () => {
      await createUser({ email: 'f@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'f@test.local', 'correct-horse-battery');

      const parent = (
        await app.inject({ method: 'POST', url: '/folders', headers: authHeaders(auth), payload: { name: 'parent' } })
      ).json().folder;
      const child = (
        await app.inject({
          method: 'POST',
          url: '/folders',
          headers: authHeaders(auth),
          payload: { name: 'child', parentId: parent.id },
        })
      ).json().folder;

      // Moving parent under its own child must fail.
      const bad = await app.inject({
        method: 'PATCH',
        url: `/folders/${parent.id}`,
        headers: authHeaders(auth),
        payload: { parentId: child.id },
      });
      expect(bad.statusCode).toBe(400);

      // A plain rename works.
      const ok = await app.inject({
        method: 'PATCH',
        url: `/folders/${parent.id}`,
        headers: authHeaders(auth),
        payload: { name: 'top' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().folder.name).toBe('top');
    });
  });

  describe('health', () => {
    it('reports readiness', async () => {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ready).toBe(true);
      expect(body.checks.database).toBe('ok');
      expect(body.checks.storage).toBe('ok');
      expect(body.checks.antivirus).toBe('disabled');
    });

    it('guards /status behind auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/status' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('admin maintenance', () => {
    it('reconciles a drifted usedBytes counter', async () => {
      const admin = await createUser({
        email: 'admin2@test.local',
        password: 'correct-horse-battery',
        role: 'ADMIN',
      });
      // Insert a file row and deliberately wrong usedBytes.
      await prisma.fileObject.create({
        data: {
          ownerId: admin.id,
          name: 'x',
          sizeBytes: 100n,
          storageKey: 'ab/cd/reconcile1',
          encMode: 'SERVER',
          wrappedKey: 'k',
          iv: 'i',
          authTag: 't',
          avStatus: 'SKIPPED',
        },
      });
      await prisma.user.update({ where: { id: admin.id }, data: { usedBytes: 999n } });

      const auth = await login(app, 'admin2@test.local', 'correct-horse-battery');
      const res = await app.inject({ method: 'POST', url: '/admin/maintenance', headers: authHeaders(auth) });
      expect(res.statusCode).toBe(200);
      expect(res.json().usersAdjusted).toBeGreaterThanOrEqual(1);

      const fixed = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(Number(fixed.usedBytes)).toBe(100);
    });
  });
});
