import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { totpAt } from '../src/services/totp.js';
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

  describe('text file versioning', () => {
    it('keeps prior content as versions and restores them', async () => {
      const user = await createUser({ email: 'v2@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'v2@test.local', 'correct-horse-battery');

      const up1 = await uploadFile(app, '/files', auth, 'notes.txt', Buffer.from('version one'));
      const fileId = up1.json().file.id;
      // Re-upload same name -> creates a version, not a duplicate.
      await uploadFile(app, '/files', auth, 'notes.txt', Buffer.from('version two!!'));

      const list = await app.inject({ method: 'GET', url: `/files`, headers: { cookie: auth.cookie } });
      expect(list.json().files).toHaveLength(1); // still one file, not two

      const versions = await app.inject({
        method: 'GET',
        url: `/files/${fileId}/versions`,
        headers: { cookie: auth.cookie },
      });
      expect(versions.json().versions).toHaveLength(1);
      const versionId = versions.json().versions[0].id;

      // Current content is "version two!!".
      const cur = await app.inject({ method: 'GET', url: `/files/${fileId}/download`, headers: { cookie: auth.cookie } });
      expect(Buffer.from(cur.rawPayload).toString()).toBe('version two!!');

      // The version downloads the old bytes.
      const vdl = await app.inject({
        method: 'GET',
        url: `/files/${fileId}/versions/${versionId}/download`,
        headers: { cookie: auth.cookie },
      });
      expect(Buffer.from(vdl.rawPayload).toString()).toBe('version one');

      // Restore the version -> current becomes "version one".
      const restore = await app.inject({
        method: 'POST',
        url: `/files/${fileId}/versions/${versionId}/restore`,
        headers: authHeaders(auth),
      });
      expect(restore.statusCode).toBe(200);
      const after = await app.inject({ method: 'GET', url: `/files/${fileId}/download`, headers: { cookie: auth.cookie } });
      expect(Buffer.from(after.rawPayload).toString()).toBe('version one');

      // Usage reflects current + retained versions (all small, non-zero) and stays consistent.
      const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const current = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
      const versionSum = await prisma.fileVersion.aggregate({
        where: { fileId },
        _sum: { sizeBytes: true },
      });
      const expected = Number(current.sizeBytes) + Number(versionSum._sum.sizeBytes ?? 0n);
      expect(Number(u.usedBytes)).toBe(expected);
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

  describe('share links', () => {
    async function setupFileShare(extra: Record<string, unknown>) {
      await createUser({ email: 's@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 's@test.local', 'correct-horse-battery');
      const up = await uploadFile(app, '/files', auth, 'shared.txt', Buffer.from('shared contents'));
      const fileId = up.json().file.id;
      const res = await app.inject({
        method: 'POST',
        url: '/shares',
        headers: authHeaders(auth),
        payload: { fileId, ...extra },
      });
      expect(res.statusCode).toBe(201);
      return { auth, fileId, token: res.json().share.token as string };
    }

    it('serves a public share and counts downloads', async () => {
      const { token, fileId } = await setupFileShare({ accessMode: 'PUBLIC', viewType: 'PAGE' });

      // Metadata is public (no auth).
      const meta = await app.inject({ method: 'GET', url: `/s/${token}` });
      expect(meta.statusCode).toBe(200);
      expect(meta.json().file.name).toBe('shared.txt');

      // Download returns the bytes.
      const dl = await app.inject({ method: 'GET', url: `/s/${token}/file/${fileId}` });
      expect(dl.statusCode).toBe(200);
      expect(Buffer.from(dl.rawPayload).toString()).toBe('shared contents');

      // Inline preview does not count; an attachment download does.
      await app.inject({ method: 'GET', url: `/s/${token}/file/${fileId}?inline=1` });
      const share = await prisma.shareLink.findFirstOrThrow({ where: { token } });
      expect(share.downloadCount).toBe(1);
    });

    it('enforces a code-protected share', async () => {
      const { token, fileId } = await setupFileShare({ accessMode: 'CODE', code: 'sesame' });

      const locked = await app.inject({ method: 'GET', url: `/s/${token}` });
      expect(locked.json().requiresCode).toBe(true);
      expect(locked.json().file).toBeUndefined();

      const denied = await app.inject({ method: 'GET', url: `/s/${token}/file/${fileId}` });
      expect(denied.statusCode).toBe(403);

      const ok = await app.inject({ method: 'GET', url: `/s/${token}?code=sesame` });
      expect(ok.json().file.name).toBe('shared.txt');
      const dl = await app.inject({ method: 'GET', url: `/s/${token}/file/${fileId}?code=sesame` });
      expect(dl.statusCode).toBe(200);
    });

    it('requires a session for an authenticated share', async () => {
      const { auth, token } = await setupFileShare({ accessMode: 'AUTHENTICATED' });

      const anon = await app.inject({ method: 'GET', url: `/s/${token}` });
      expect(anon.json().requiresAuth).toBe(true);

      const signedIn = await app.inject({ method: 'GET', url: `/s/${token}`, headers: { cookie: auth.cookie } });
      expect(signedIn.json().file.name).toBe('shared.txt');
    });

    it('honours maxDownloads and revocation', async () => {
      const { token, fileId } = await setupFileShare({ accessMode: 'PUBLIC', maxDownloads: 1 });

      const first = await app.inject({ method: 'GET', url: `/s/${token}/file/${fileId}` });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({ method: 'GET', url: `/s/${token}/file/${fileId}` });
      expect(second.statusCode).toBe(410);

      // Revoke and confirm the link is gone.
      const share = await prisma.shareLink.findFirstOrThrow({ where: { token } });
      const auth = await login(app, 's@test.local', 'correct-horse-battery');
      const del = await app.inject({ method: 'DELETE', url: `/shares/${share.id}`, headers: authHeaders(auth) });
      expect(del.statusCode).toBe(200);
      const gone = await app.inject({ method: 'GET', url: `/s/${token}` });
      expect(gone.statusCode).toBe(404);
    });

    it('refuses to share a vault folder', async () => {
      await createUser({ email: 'sv@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'sv@test.local', 'correct-horse-battery');
      const vault = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: authHeaders(auth),
        payload: { name: 'secret', isZeroKnowledge: true },
      });
      const folderId = vault.json().folder.id;
      const res = await app.inject({
        method: 'POST',
        url: '/shares',
        headers: authHeaders(auth),
        payload: { folderId, accessMode: 'PUBLIC' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('two-factor and sessions', () => {
    async function enableTwoFa(email: string) {
      await createUser({ email, password: 'correct-horse-battery' });
      const auth = await login(app, email, 'correct-horse-battery');
      const setup = await app.inject({ method: 'POST', url: '/2fa/setup', headers: authHeaders(auth) });
      const secret = setup.json().secret as string;
      const enable = await app.inject({
        method: 'POST',
        url: '/2fa/enable',
        headers: authHeaders(auth),
        payload: { token: totpAt(secret, Date.now()) },
      });
      expect(enable.statusCode).toBe(200);
      return { secret, recoveryCodes: enable.json().recoveryCodes as string[] };
    }

    it('requires a TOTP code after enabling, and accepts a recovery code', async () => {
      const { secret, recoveryCodes } = await enableTwoFa('tfa@test.local');
      expect(recoveryCodes).toHaveLength(10);

      // Password alone is no longer enough.
      const noCode = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'tfa@test.local', password: 'correct-horse-battery' },
      });
      expect(noCode.statusCode).toBe(401);
      expect(noCode.json().code).toBe('TOTP_REQUIRED');

      // A wrong code is rejected.
      const wrong = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'tfa@test.local', password: 'correct-horse-battery', totp: '000000' },
      });
      expect(wrong.statusCode).toBe(401);

      // The current TOTP works.
      const ok = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'tfa@test.local', password: 'correct-horse-battery', totp: totpAt(secret, Date.now()) },
      });
      expect(ok.statusCode).toBe(200);

      // A recovery code works once, then is consumed.
      const rec = recoveryCodes[0];
      const recOk = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'tfa@test.local', password: 'correct-horse-battery', totp: rec },
      });
      expect(recOk.statusCode).toBe(200);
      const recAgain = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'tfa@test.local', password: 'correct-horse-battery', totp: rec },
      });
      expect(recAgain.statusCode).toBe(401);
    });

    it('lists and revokes sessions', async () => {
      await createUser({ email: 'sess@test.local', password: 'correct-horse-battery' });
      const a1 = await login(app, 'sess@test.local', 'correct-horse-battery');
      await login(app, 'sess@test.local', 'correct-horse-battery'); // a second session

      const list = await app.inject({ method: 'GET', url: '/auth/sessions', headers: { cookie: a1.cookie } });
      expect(list.statusCode).toBe(200);
      expect(list.json().sessions.length).toBe(2);
      expect(list.json().sessions.some((s: { current: boolean }) => s.current)).toBe(true);

      const revoked = await app.inject({
        method: 'DELETE',
        url: '/auth/sessions',
        headers: authHeaders(a1),
      });
      expect(revoked.json().revoked).toBe(1);
      const after = await app.inject({ method: 'GET', url: '/auth/sessions', headers: { cookie: a1.cookie } });
      expect(after.json().sessions.length).toBe(1);
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
