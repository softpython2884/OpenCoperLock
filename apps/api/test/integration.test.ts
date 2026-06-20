import FormData from 'form-data';
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

      // Delete moves the file to the Trash — quota is still held until it is purged.
      const del = await app.inject({
        method: 'DELETE',
        url: `/files/${fileId}`,
        headers: authHeaders(auth),
      });
      expect(del.statusCode).toBe(200);
      const trashed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(Number(trashed.usedBytes)).toBeGreaterThan(0);

      // Purging it from the Trash releases the quota.
      const purge = await app.inject({
        method: 'DELETE',
        url: `/trash/files/${fileId}`,
        headers: authHeaders(auth),
      });
      expect(purge.statusCode).toBe(200);
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

    it('gives each vault its own ZK salt and normal folders none', async () => {
      await createUser({ email: 'vs2@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'vs2@test.local', 'correct-horse-battery');
      const normal = await app.inject({ method: 'POST', url: '/folders', headers: authHeaders(auth), payload: { name: 'plain' } });
      expect(normal.json().folder.zkSalt).toBeNull();
      const v1 = await app.inject({ method: 'POST', url: '/folders', headers: authHeaders(auth), payload: { name: 'vaultA', isZeroKnowledge: true } });
      const v2 = await app.inject({ method: 'POST', url: '/folders', headers: authHeaders(auth), payload: { name: 'vaultB', isZeroKnowledge: true } });
      expect(typeof v1.json().folder.zkSalt).toBe('string');
      expect(v1.json().folder.zkSalt).not.toBe(v2.json().folder.zkSalt); // unique per vault
    });

    it('stores and serves ZK ciphertext byte-for-byte (non-zero size)', async () => {
      await createUser({ email: 'zkup@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'zkup@test.local', 'correct-horse-battery');
      const vault = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: authHeaders(auth),
        payload: { name: 'vault', isZeroKnowledge: true },
      });
      const folderId = vault.json().folder.id as string;

      // The server treats the blob as opaque ciphertext, so any bytes exercise the path.
      const cipher = Buffer.from('this-pretends-to-be-encrypted-bytes-0123456789');
      const form = new FormData();
      form.append(
        'meta',
        JSON.stringify({ folderId, encryptedName: 'iv.ct', iv: 'aXY=', wrappedKey: 'aXY=.d3I=', encMode: 'ZK' }),
      );
      form.append('file', cipher, { filename: 'blob', contentType: 'application/octet-stream' });
      const up = await app.inject({
        method: 'POST',
        url: '/zk/files',
        payload: form.getBuffer(),
        headers: { ...form.getHeaders(), ...authHeaders(auth) },
      });
      expect(up.statusCode).toBe(201);

      const list = await app.inject({ method: 'GET', url: `/zk/files?folderId=${folderId}`, headers: { cookie: auth.cookie } });
      const entry = list.json().files[0];
      expect(entry.sizeBytes).toBe(cipher.length); // regression guard: must NOT be 0
      expect(entry.iv).toBe('aXY=');
      expect(entry.wrappedKey).toBe('aXY=.d3I=');
      expect(entry.encryptedName).toBe('iv.ct');

      const blob = await app.inject({ method: 'GET', url: `/zk/files/${entry.id}/blob`, headers: { cookie: auth.cookie } });
      expect(Buffer.from(blob.rawPayload).equals(cipher)).toBe(true); // byte-for-byte round-trip
    });

    it('replaces a ZK file in place (editor save) keeping the same id', async () => {
      const user = await createUser({ email: 'zked@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'zked@test.local', 'correct-horse-battery');
      const vault = await app.inject({ method: 'POST', url: '/folders', headers: authHeaders(auth), payload: { name: 'vault', isZeroKnowledge: true } });
      const folderId = vault.json().folder.id as string;

      const first = new FormData();
      first.append('meta', JSON.stringify({ folderId, encryptedName: 'a.b', iv: 'aXY=', wrappedKey: 'aXY=.d3I=', encMode: 'ZK' }));
      first.append('file', Buffer.from('short'), { filename: 'blob', contentType: 'application/octet-stream' });
      const up = await app.inject({ method: 'POST', url: '/zk/files', payload: first.getBuffer(), headers: { ...first.getHeaders(), ...authHeaders(auth) } });
      const id = up.json().id as string;
      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(Number(before.usedBytes)).toBe(5);

      const longer = Buffer.from('a much longer ciphertext payload');
      const put = new FormData();
      put.append('meta', JSON.stringify({ encryptedName: 'c.d', iv: 'enc=', wrappedKey: 'enc=.W=' }));
      put.append('file', longer, { filename: 'blob', contentType: 'application/octet-stream' });
      const res = await app.inject({ method: 'PUT', url: `/zk/files/${id}`, payload: put.getBuffer(), headers: { ...put.getHeaders(), ...authHeaders(auth) } });
      expect(res.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: `/zk/files?folderId=${folderId}`, headers: { cookie: auth.cookie } });
      expect(list.json().files).toHaveLength(1); // still one file, same id
      expect(list.json().files[0].id).toBe(id);
      expect(list.json().files[0].iv).toBe('enc='); // metadata updated
      const blob = await app.inject({ method: 'GET', url: `/zk/files/${id}/blob`, headers: { cookie: auth.cookie } });
      expect(Buffer.from(blob.rawPayload).equals(longer)).toBe(true);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(Number(after.usedBytes)).toBe(longer.length); // quota tracks the delta
    });

    it('rejects a ZK upload that exceeds the quota', async () => {
      await createUser({ email: 'zkq@test.local', password: 'correct-horse-battery', quotaBytes: 8n });
      const auth = await login(app, 'zkq@test.local', 'correct-horse-battery');
      const vault = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: authHeaders(auth),
        payload: { name: 'vault', isZeroKnowledge: true },
      });
      const folderId = vault.json().folder.id as string;
      const form = new FormData();
      form.append('meta', JSON.stringify({ folderId, encryptedName: 'iv.ct', iv: 'aXY=', wrappedKey: 'aXY=.d3I=', encMode: 'ZK' }));
      form.append('file', Buffer.alloc(64), { filename: 'blob', contentType: 'application/octet-stream' });
      const up = await app.inject({
        method: 'POST',
        url: '/zk/files',
        payload: form.getBuffer(),
        headers: { ...form.getHeaders(), ...authHeaders(auth) },
      });
      expect(up.statusCode).toBe(413);
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

  describe('quick-upload codes', () => {
    it('accepts a memorable custom code, matched case-insensitively, and rejects duplicates', async () => {
      await createUser({ email: 'qc@test.local', password: 'correct-horse-battery', role: 'ADMIN' });
      const auth = await login(app, 'qc@test.local', 'correct-horse-battery');

      const created = await app.inject({
        method: 'POST',
        url: '/admin/quick-codes',
        headers: authHeaders(auth),
        payload: { code: 'night-2024', usageLimit: 5 },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json().code.code).toBe('NIGHT-2024'); // normalised to uppercase

      // A guest can probe it regardless of the case they type.
      const probe = await app.inject({ method: 'GET', url: '/quick/Night-2024' });
      expect(probe.statusCode).toBe(200);
      expect(probe.json().valid).toBe(true);

      // The same code can't be created twice.
      const dup = await app.inject({
        method: 'POST',
        url: '/admin/quick-codes',
        headers: authHeaders(auth),
        payload: { code: 'NIGHT-2024' },
      });
      expect(dup.statusCode).toBe(409);

      // An invalid code shape is rejected by validation.
      const bad = await app.inject({
        method: 'POST',
        url: '/admin/quick-codes',
        headers: authHeaders(auth),
        payload: { code: 'no spaces!' },
      });
      expect(bad.statusCode).toBe(400);
    });

    it('drops code uploads with no explicit target into the owner Fast-Upload folder', async () => {
      const admin = await createUser({ email: 'fu@test.local', password: 'correct-horse-battery', role: 'ADMIN' });
      const auth = await login(app, 'fu@test.local', 'correct-horse-battery');

      // A code with no targetFolderId.
      const created = await app.inject({
        method: 'POST',
        url: '/admin/quick-codes',
        headers: authHeaders(auth),
        payload: {},
      });
      expect(created.statusCode).toBe(201);
      const code = created.json().code.code as string;

      // Guest upload (no auth / no CSRF on the public quick route).
      const form = new FormData();
      form.append('file', Buffer.from('dropped by code'), { filename: 'drop.txt', contentType: 'text/plain' });
      const up = await app.inject({
        method: 'POST',
        url: `/quick/${code}`,
        payload: form.getBuffer(),
        headers: form.getHeaders(),
      });
      expect(up.statusCode).toBe(201);

      // The file landed in the owner's Fast-Upload folder.
      const fastFolder = await prisma.folder.findFirst({
        where: { ownerId: admin.id, parentId: null, name: 'Fast-Upload' },
      });
      expect(fastFolder).not.toBeNull();
      const listed = await app.inject({
        method: 'GET',
        url: `/files?folderId=${fastFolder!.id}`,
        headers: authHeaders(auth),
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().files.map((f: { name: string }) => f.name)).toContain('drop.txt');
    });
  });

  describe('trash (soft-delete)', () => {
    it('soft-deletes, hides from listings, restores, then purges and frees quota', async () => {
      await createUser({ email: 'trash@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'trash@test.local', 'correct-horse-battery');
      const up = await uploadFile(app, '/files', auth, 'doc.txt', Buffer.from('hello trash'));
      const fileId = up.json().file.id as string;

      // Delete → goes to the Trash (still counts against quota).
      const del = await app.inject({ method: 'DELETE', url: `/files/${fileId}`, headers: authHeaders(auth) });
      expect(del.statusCode).toBe(200);

      const list = await app.inject({ method: 'GET', url: '/files', headers: { cookie: auth.cookie } });
      expect(list.json().files.map((f: { id: string }) => f.id)).not.toContain(fileId);

      const trash = await app.inject({ method: 'GET', url: '/trash', headers: { cookie: auth.cookie } });
      expect(trash.json().entries.map((e: { id: string }) => e.id)).toContain(fileId);

      const me1 = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: auth.cookie } });
      expect(me1.json().user.usedBytes).toBeGreaterThan(0);

      // Restore → back in the listing.
      const restore = await app.inject({ method: 'POST', url: `/trash/files/${fileId}/restore`, headers: authHeaders(auth) });
      expect(restore.statusCode).toBe(200);
      const list2 = await app.inject({ method: 'GET', url: '/files', headers: { cookie: auth.cookie } });
      expect(list2.json().files.map((f: { id: string }) => f.id)).toContain(fileId);

      // Delete again then purge → gone from Trash and quota released.
      await app.inject({ method: 'DELETE', url: `/files/${fileId}`, headers: authHeaders(auth) });
      const purge = await app.inject({ method: 'DELETE', url: `/trash/files/${fileId}`, headers: authHeaders(auth) });
      expect(purge.statusCode).toBe(200);
      const trash2 = await app.inject({ method: 'GET', url: '/trash', headers: { cookie: auth.cookie } });
      expect(trash2.json().entries.length).toBe(0);
      const me2 = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: auth.cookie } });
      expect(me2.json().user.usedBytes).toBe(0);
    });

    it('trashing a folder hides its files and restoring brings them back', async () => {
      await createUser({ email: 'trash2@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'trash2@test.local', 'correct-horse-battery');
      const folder = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: authHeaders(auth),
        payload: { name: 'box' },
      });
      const folderId = folder.json().folder.id as string;
      const up = await uploadFile(app, `/files?folderId=${folderId}`, auth, 'inside.txt', Buffer.from('x'));
      const fileId = up.json().file.id as string;

      await app.inject({ method: 'DELETE', url: `/folders/${folderId}`, headers: authHeaders(auth) });
      // Folder shows as a single Trash root; its file is hidden (trashed via the parent).
      const trash = await app.inject({ method: 'GET', url: '/trash', headers: { cookie: auth.cookie } });
      const ids = trash.json().entries.map((e: { id: string }) => e.id);
      expect(ids).toContain(folderId);
      expect(ids).not.toContain(fileId);

      await app.inject({ method: 'POST', url: `/trash/folders/${folderId}/restore`, headers: authHeaders(auth) });
      const files = await app.inject({ method: 'GET', url: `/files?folderId=${folderId}`, headers: { cookie: auth.cookie } });
      expect(files.json().files.map((f: { id: string }) => f.id)).toContain(fileId);
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

  describe('account (GDPR) and admin alerts', () => {
    it('exports the user data as JSON', async () => {
      await createUser({ email: 'exp@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'exp@test.local', 'correct-horse-battery');
      await uploadFile(app, '/files', auth, 'a.txt', Buffer.from('hi'));
      const res = await app.inject({ method: 'GET', url: '/account/export', headers: { cookie: auth.cookie } });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.user.email).toBe('exp@test.local');
      expect(data.files).toHaveLength(1);
      expect(Array.isArray(data.activity)).toBe(true);
    });

    it('deletes the account after password confirmation, removing data', async () => {
      const user = await createUser({ email: 'del@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'del@test.local', 'correct-horse-battery');
      await uploadFile(app, '/files', auth, 'a.txt', Buffer.from('bye'));

      const wrong = await app.inject({
        method: 'POST',
        url: '/account/delete',
        headers: authHeaders(auth),
        payload: { password: 'nope' },
      });
      expect(wrong.statusCode).toBe(401);

      const ok = await app.inject({
        method: 'POST',
        url: '/account/delete',
        headers: authHeaders(auth),
        payload: { password: 'correct-horse-battery' },
      });
      expect(ok.statusCode).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      expect(await prisma.fileObject.count({ where: { ownerId: user.id } })).toBe(0);
    });

    it('refuses to delete the only administrator', async () => {
      await createUser({ email: 'soleadmin@test.local', password: 'correct-horse-battery', role: 'ADMIN' });
      const auth = await login(app, 'soleadmin@test.local', 'correct-horse-battery');
      const res = await app.inject({
        method: 'POST',
        url: '/account/delete',
        headers: authHeaders(auth),
        payload: { password: 'correct-horse-battery' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('reports infected-file alerts to admins', async () => {
      const admin = await createUser({ email: 'al@test.local', password: 'correct-horse-battery', role: 'ADMIN' });
      await prisma.fileObject.create({
        data: {
          ownerId: admin.id,
          name: 'bad',
          sizeBytes: 1n,
          storageKey: 'ab/cd/infected1',
          encMode: 'SERVER',
          wrappedKey: 'k',
          iv: 'i',
          authTag: 't',
          avStatus: 'INFECTED',
        },
      });
      const auth = await login(app, 'al@test.local', 'correct-horse-battery');
      const res = await app.inject({ method: 'GET', url: '/admin/alerts', headers: { cookie: auth.cookie } });
      expect(res.json().infectedCount).toBeGreaterThanOrEqual(1);
      expect(res.json().warnings.some((w: string) => w.includes('infected'))).toBe(true);
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
