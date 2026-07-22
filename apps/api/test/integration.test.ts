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

      // The same code can't be created twice. The response is deliberately generic (403
      // UNAUTHORIZED, not a 409) so it never reveals whether a given code already exists.
      const dup = await app.inject({
        method: 'POST',
        url: '/admin/quick-codes',
        headers: authHeaders(auth),
        payload: { code: 'NIGHT-2024' },
      });
      expect(dup.statusCode).toBe(403);

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

  describe('shared spaces', () => {
    async function makeSpace(ownerEmail: string) {
      const owner = await createUser({ email: ownerEmail, password: 'correct-horse-battery' });
      const auth = await login(app, ownerEmail, 'correct-horse-battery');
      const res = await app.inject({ method: 'POST', url: '/spaces', headers: authHeaders(auth), payload: { name: 'Team' } });
      expect(res.statusCode).toBe(201);
      return { owner, auth, spaceId: res.json().space.id as string };
    }

    it('charges the owner, lets EDITORs write, keeps VIEWERs read-only, and blocks non-members', async () => {
      const { owner, auth: ownerAuth, spaceId } = await makeSpace('sp-owner@test.local');
      await createUser({ email: 'sp-editor@test.local', password: 'correct-horse-battery' });
      await createUser({ email: 'sp-viewer@test.local', password: 'correct-horse-battery' });
      await createUser({ email: 'sp-stranger@test.local', password: 'correct-horse-battery' });

      // Owner adds an EDITOR and a VIEWER by email.
      const addE = await app.inject({ method: 'POST', url: `/spaces/${spaceId}/members`, headers: authHeaders(ownerAuth), payload: { email: 'sp-editor@test.local', role: 'EDITOR' } });
      expect(addE.statusCode).toBe(201);
      await app.inject({ method: 'POST', url: `/spaces/${spaceId}/members`, headers: authHeaders(ownerAuth), payload: { email: 'sp-viewer@test.local', role: 'VIEWER' } });

      // EDITOR uploads — billed to the OWNER's quota, with ownerId = owner.
      const editorAuth = await login(app, 'sp-editor@test.local', 'correct-horse-battery');
      const payload = Buffer.from('shared space content');
      const up = await uploadFile(app, `/spaces/${spaceId}/files`, editorAuth, 'doc.txt', payload);
      expect(up.statusCode).toBe(201);
      const fileId = up.json().file.id as string;
      const ownerRow = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
      expect(Number(ownerRow.usedBytes)).toBe(payload.length);
      const fileRow = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId } });
      expect(fileRow.ownerId).toBe(owner.id);
      expect(fileRow.spaceId).toBe(spaceId);

      // VIEWER can read & download but not upload or delete.
      const viewerAuth = await login(app, 'sp-viewer@test.local', 'correct-horse-battery');
      const vlist = await app.inject({ method: 'GET', url: `/spaces/${spaceId}/files`, headers: { cookie: viewerAuth.cookie } });
      expect(vlist.statusCode).toBe(200);
      expect(vlist.json().files.map((f: { id: string }) => f.id)).toContain(fileId);
      const vdl = await app.inject({ method: 'GET', url: `/spaces/${spaceId}/files/${fileId}/download`, headers: { cookie: viewerAuth.cookie } });
      expect(vdl.statusCode).toBe(200);
      expect(Buffer.from(vdl.rawPayload).equals(payload)).toBe(true);
      const vup = await uploadFile(app, `/spaces/${spaceId}/files`, viewerAuth, 'nope.txt', Buffer.from('x'));
      expect(vup.statusCode).toBe(403);
      const vdel = await app.inject({ method: 'DELETE', url: `/spaces/${spaceId}/files/${fileId}`, headers: authHeaders(viewerAuth) });
      expect(vdel.statusCode).toBe(403);

      // A non-member sees nothing — the space appears not to exist.
      const strangerAuth = await login(app, 'sp-stranger@test.local', 'correct-horse-battery');
      expect((await app.inject({ method: 'GET', url: `/spaces/${spaceId}`, headers: { cookie: strangerAuth.cookie } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/spaces/${spaceId}/files`, headers: { cookie: strangerAuth.cookie } })).statusCode).toBe(404);

      // Isolation: the space content never leaks into the owner's personal Drive listings.
      const personalFiles = await app.inject({ method: 'GET', url: '/files', headers: { cookie: ownerAuth.cookie } });
      expect(personalFiles.json().files.map((f: { id: string }) => f.id)).not.toContain(fileId);
      const personalFolders = await app.inject({ method: 'GET', url: '/folders', headers: { cookie: ownerAuth.cookie } });
      expect(personalFolders.json().folders.length).toBe(0);
    });

    it('transfers ownership and the storage cost to the earliest member', async () => {
      const { owner, auth: ownerAuth, spaceId } = await makeSpace('tr-owner@test.local');
      const heir = await createUser({ email: 'tr-heir@test.local', password: 'correct-horse-battery' });
      await app.inject({ method: 'POST', url: `/spaces/${spaceId}/members`, headers: authHeaders(ownerAuth), payload: { email: 'tr-heir@test.local', role: 'EDITOR' } });

      const payload = Buffer.from('to be inherited');
      await uploadFile(app, `/spaces/${spaceId}/files`, ownerAuth, 'doc.txt', payload);
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).usedBytes)).toBe(payload.length);

      const del = await app.inject({ method: 'DELETE', url: `/spaces/${spaceId}?mode=transfer`, headers: authHeaders(ownerAuth) });
      expect(del.statusCode).toBe(200);
      expect(del.json().transferredTo).toBe(heir.id);

      // Quota moved from old owner to heir; the space and its files now belong to the heir.
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).usedBytes)).toBe(0);
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: heir.id } })).usedBytes)).toBe(payload.length);
      const space = await prisma.sharedSpace.findUniqueOrThrow({ where: { id: spaceId } });
      expect(space.ownerId).toBe(heir.id);
      expect(await prisma.sharedSpaceMember.count({ where: { spaceId } })).toBe(0); // heir is now owner, not a member

      // The heir now sees the space as OWNER; the old owner has lost access.
      const heirAuth = await login(app, 'tr-heir@test.local', 'correct-horse-battery');
      const seen = await app.inject({ method: 'GET', url: `/spaces/${spaceId}`, headers: { cookie: heirAuth.cookie } });
      expect(seen.json().space.myRole).toBe('OWNER');
      expect((await app.inject({ method: 'GET', url: `/spaces/${spaceId}`, headers: { cookie: ownerAuth.cookie } })).statusCode).toBe(404);
    });

    it('delete mode wipes the space content and frees the owner quota', async () => {
      const { owner, auth: ownerAuth, spaceId } = await makeSpace('dl-owner@test.local');
      await uploadFile(app, `/spaces/${spaceId}/files`, ownerAuth, 'doc.txt', Buffer.from('disposable'));
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).usedBytes)).toBeGreaterThan(0);

      const del = await app.inject({ method: 'DELETE', url: `/spaces/${spaceId}?mode=delete`, headers: authHeaders(ownerAuth) });
      expect(del.statusCode).toBe(200);
      expect(del.json().deleted).toBe(true);
      expect(await prisma.sharedSpace.findUnique({ where: { id: spaceId } })).toBeNull();
      expect(await prisma.fileObject.count({ where: { spaceId } })).toBe(0);
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).usedBytes)).toBe(0);
    });
  });

  describe("what's new", () => {
    it('stays silent on first contact, then shows release notes once per build', async () => {
      const user = await createUser({ email: 'wn@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'wn@test.local', 'correct-horse-battery');

      // First load: nothing to show, and the current build is remembered silently.
      const first = await app.inject({ method: 'GET', url: '/version/whats-new', headers: { cookie: auth.cookie } });
      expect(first.statusCode).toBe(200);
      expect(first.json().show).toBe(false);
      const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      // The test checkout is a git repo, so a build SHA was recorded.
      expect(afterFirst.lastSeenVersion).toBeTruthy();

      // Simulate having last seen an older build → notes appear (range falls back to recent commits).
      await prisma.user.update({ where: { id: user.id }, data: { lastSeenVersion: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } });
      const shown = await app.inject({ method: 'GET', url: '/version/whats-new', headers: { cookie: auth.cookie } });
      expect(shown.json().show).toBe(true);
      expect(Array.isArray(shown.json().entries)).toBe(true);
      expect(shown.json().entries.length).toBeGreaterThan(0);
      // Entries are structured (a title at minimum), not a raw markdown blob.
      expect(typeof shown.json().entries[0].title).toBe('string');

      // Dismissing records the current build, so it never shows again for this version.
      const seen = await app.inject({ method: 'POST', url: '/version/whats-new/seen', headers: authHeaders(auth) });
      expect(seen.statusCode).toBe(200);
      const again = await app.inject({ method: 'GET', url: '/version/whats-new', headers: { cookie: auth.cookie } });
      expect(again.json().show).toBe(false);
    });
  });

  describe('admin version history & rollback', () => {
    it('lists history and validates rollback targets', async () => {
      await createUser({ email: 'rb@test.local', password: 'correct-horse-battery', role: 'ADMIN' });
      const auth = await login(app, 'rb@test.local', 'correct-horse-battery');

      const hist = await app.inject({ method: 'GET', url: '/admin/version/history', headers: { cookie: auth.cookie } });
      expect(hist.statusCode).toBe(200);
      expect(Array.isArray(hist.json().history)).toBe(true);
      const currentSha = hist.json().currentSha as string | null;

      // A malformed SHA is rejected up front.
      const bad = await app.inject({ method: 'POST', url: '/admin/rollback', headers: authHeaders(auth), payload: { sha: 'not-a-sha' } });
      expect(bad.statusCode).toBe(400);

      // A well-formed but unknown SHA isn't an ancestor of HEAD → refused (never goes forward/sideways).
      const unknown = await app.inject({ method: 'POST', url: '/admin/rollback', headers: authHeaders(auth), payload: { sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' } });
      expect(unknown.statusCode).toBe(400);

      // Rolling back to the version already running is a no-op error.
      if (currentSha) {
        const same = await app.inject({ method: 'POST', url: '/admin/rollback', headers: authHeaders(auth), payload: { sha: currentSha } });
        expect(same.statusCode).toBe(400);
      }
    });
  });

  describe('zero-knowledge instant delete', () => {
    it('permanently deletes a vault file at once (never via the Trash) and frees quota', async () => {
      const user = await createUser({ email: 'zkdel@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'zkdel@test.local', 'correct-horse-battery');
      const vault = await app.inject({ method: 'POST', url: '/folders', headers: authHeaders(auth), payload: { name: 'vault', isZeroKnowledge: true } });
      const folderId = vault.json().folder.id as string;

      const cipher = Buffer.from('opaque-zk-bytes-to-delete');
      const form = new FormData();
      form.append('meta', JSON.stringify({ folderId, encryptedName: 'iv.ct', iv: 'aXY=', wrappedKey: 'aXY=.d3I=', encMode: 'ZK' }));
      form.append('file', cipher, { filename: 'blob', contentType: 'application/octet-stream' });
      const up = await app.inject({ method: 'POST', url: '/zk/files', payload: form.getBuffer(), headers: { ...form.getHeaders(), ...authHeaders(auth) } });
      const id = up.json().id as string;
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).usedBytes)).toBe(cipher.length);

      const del = await app.inject({ method: 'DELETE', url: `/zk/files/${id}`, headers: authHeaders(auth) });
      expect(del.statusCode).toBe(200);

      // Gone for good, not in the Trash, and the quota is freed immediately.
      expect(await prisma.fileObject.findUnique({ where: { id } })).toBeNull();
      const trash = await app.inject({ method: 'GET', url: '/trash', headers: { cookie: auth.cookie } });
      expect(trash.json().entries.length).toBe(0);
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).usedBytes)).toBe(0);
    });
  });

  describe('per-user trash retention', () => {
    it('auto-purges only past a user\'s own retention window', async () => {
      const user = await createUser({ email: 'ret@test.local', password: 'correct-horse-battery', role: 'ADMIN' });
      const auth = await login(app, 'ret@test.local', 'correct-horse-battery');

      // Trash a file and backdate its deletion to 10 days ago.
      const up = await uploadFile(app, '/files', auth, 'old.txt', Buffer.from('stale'));
      const fileId = up.json().file.id as string;
      await app.inject({ method: 'DELETE', url: `/files/${fileId}`, headers: authHeaders(auth) });
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await prisma.fileObject.update({ where: { id: fileId }, data: { deletedAt: tenDaysAgo } });

      // Retention 7 (default) → the 10-day-old item is purged by maintenance.
      await app.inject({ method: 'POST', url: '/admin/maintenance', headers: authHeaders(auth) });
      expect(await prisma.fileObject.findUnique({ where: { id: fileId } })).toBeNull();

      // Retention 0 ("Never") → a stale item is kept.
      await prisma.user.update({ where: { id: user.id }, data: { trashRetentionDays: 0 } });
      const up2 = await uploadFile(app, '/files', auth, 'keep.txt', Buffer.from('stale2'));
      const fileId2 = up2.json().file.id as string;
      await app.inject({ method: 'DELETE', url: `/files/${fileId2}`, headers: authHeaders(auth) });
      await prisma.fileObject.update({ where: { id: fileId2 }, data: { deletedAt: tenDaysAgo } });
      await app.inject({ method: 'POST', url: '/admin/maintenance', headers: authHeaders(auth) });
      expect(await prisma.fileObject.findUnique({ where: { id: fileId2 } })).not.toBeNull();
    });

    it('persists the retention choice via the account endpoint', async () => {
      await createUser({ email: 'ret2@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'ret2@test.local', 'correct-horse-battery');
      const def = await app.inject({ method: 'GET', url: '/account/trash-retention', headers: { cookie: auth.cookie } });
      expect(def.json().trashRetentionDays).toBe(7);
      const set = await app.inject({ method: 'PATCH', url: '/account/trash-retention', headers: authHeaders(auth), payload: { trashRetentionDays: 30 } });
      expect(set.statusCode).toBe(200);
      expect(set.json().trashRetentionDays).toBe(30);
      const bad = await app.inject({ method: 'PATCH', url: '/account/trash-retention', headers: authHeaders(auth), payload: { trashRetentionDays: -5 } });
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('admin: empty a user\'s storage', () => {
    it('wipes content (personal + owned spaces) but keeps the account', async () => {
      await createUser({ email: 'adminw@test.local', password: 'correct-horse-battery', role: 'ADMIN' });
      const adminAuth = await login(app, 'adminw@test.local', 'correct-horse-battery');
      const target = await createUser({ email: 'victim@test.local', password: 'correct-horse-battery' });
      const targetAuth = await login(app, 'victim@test.local', 'correct-horse-battery');

      await uploadFile(app, '/files', targetAuth, 'a.txt', Buffer.from('personal file'));
      const space = await app.inject({ method: 'POST', url: '/spaces', headers: authHeaders(targetAuth), payload: { name: 'Team' } });
      const spaceId = space.json().space.id as string;
      await uploadFile(app, `/spaces/${spaceId}/files`, targetAuth, 'b.txt', Buffer.from('space file'));
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).usedBytes)).toBeGreaterThan(0);

      const res = await app.inject({ method: 'POST', url: `/admin/users/${target.id}/purge-content`, headers: authHeaders(adminAuth) });
      expect(res.statusCode).toBe(200);
      expect(res.json().filesDeleted).toBe(2);

      // Account survives; storage is empty.
      expect(await prisma.user.findUnique({ where: { id: target.id } })).not.toBeNull();
      expect(await prisma.fileObject.count({ where: { ownerId: target.id } })).toBe(0);
      expect(await prisma.folder.count({ where: { ownerId: target.id } })).toBe(0);
      expect(await prisma.sharedSpace.count({ where: { ownerId: target.id } })).toBe(0);
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).usedBytes)).toBe(0);
      // The user can still log in.
      const relog = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'victim@test.local', password: 'correct-horse-battery' } });
      expect(relog.statusCode).toBe(200);
    });
  });

  describe('public / open spaces', () => {
    async function makePublicSpace(auth: Awaited<ReturnType<typeof login>>) {
      const res = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: authHeaders(auth),
        payload: { name: 'CDN', isPublic: true },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().folder.isPublic).toBe(true);
      return res.json().folder.id as string;
    }
    async function uploadPublic(
      auth: Awaited<ReturnType<typeof login>>,
      folderId: string,
      filename: string,
      contents: Buffer,
      contentType: string,
    ) {
      const form = new FormData();
      form.append('file', contents, { filename, contentType });
      return app.inject({
        method: 'POST',
        url: `/files?folderId=${folderId}`,
        payload: form.getBuffer(),
        headers: { ...form.getHeaders(), ...authHeaders(auth) },
      });
    }

    it('stores plaintext and serves the raw bytes publicly with the right headers', async () => {
      const user = await createUser({ email: 'pub@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'pub@test.local', 'correct-horse-battery');
      const folderId = await makePublicSpace(auth);
      const body = Buffer.from('PNGDATA-'.repeat(64));
      const up = await uploadPublic(auth, folderId, 'pic.png', body, 'image/png');
      expect(up.statusCode).toBe(201);
      const f = up.json().file;
      expect(f.encMode).toBe('PUBLIC');
      expect(typeof f.publicSlug).toBe('string');
      expect(Number((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).usedBytes)).toBe(body.length);
      // Stored plaintext: no crypto material on the row.
      const row = await prisma.fileObject.findUniqueOrThrow({ where: { id: f.id } });
      expect(row.wrappedKey).toBeNull();
      expect(row.iv).toBeNull();

      // Public, unauthenticated serving.
      const res = await app.inject({ method: 'GET', url: `/p/${f.publicSlug}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['access-control-allow-origin']).toBe('*');
      // Must override Helmet's same-origin CORP, else other sites can't embed the media.
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(String(res.headers['cache-control'])).toContain('immutable');
      expect(Buffer.from(res.rawPayload).equals(body)).toBe(true);
      // The cosmetic /<name> suffix serves identically.
      const named = await app.inject({ method: 'GET', url: `/p/${f.publicSlug}/pic.png` });
      expect(named.statusCode).toBe(200);
    });

    it('supports range requests (206), suffix ranges, ETag (304) and bad ranges (416)', async () => {
      await createUser({ email: 'pub2@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'pub2@test.local', 'correct-horse-battery');
      const folderId = await makePublicSpace(auth);
      const body = Buffer.from('0123456789abcdef'.repeat(10)); // 160 bytes
      const slug = (await uploadPublic(auth, folderId, 'v.bin', body, 'application/octet-stream')).json().file.publicSlug;

      const range = await app.inject({ method: 'GET', url: `/p/${slug}`, headers: { range: 'bytes=0-9' } });
      expect(range.statusCode).toBe(206);
      expect(range.headers['content-range']).toBe(`bytes 0-9/${body.length}`);
      expect(range.headers['content-length']).toBe('10');
      expect(Buffer.from(range.rawPayload).equals(body.subarray(0, 10))).toBe(true);

      const suffix = await app.inject({ method: 'GET', url: `/p/${slug}`, headers: { range: 'bytes=-5' } });
      expect(suffix.statusCode).toBe(206);
      expect(Buffer.from(suffix.rawPayload).equals(body.subarray(body.length - 5))).toBe(true);

      const full = await app.inject({ method: 'GET', url: `/p/${slug}` });
      const etag = full.headers['etag'] as string;
      expect(etag).toBeTruthy();
      const cond = await app.inject({ method: 'GET', url: `/p/${slug}`, headers: { 'if-none-match': etag } });
      expect(cond.statusCode).toBe(304);

      const bad = await app.inject({ method: 'GET', url: `/p/${slug}`, headers: { range: 'bytes=999-1000' } });
      expect(bad.statusCode).toBe(416);
    });

    it('404s a trashed public file and an unknown slug', async () => {
      await createUser({ email: 'pub3@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'pub3@test.local', 'correct-horse-battery');
      const folderId = await makePublicSpace(auth);
      const up = await uploadPublic(auth, folderId, 'x.png', Buffer.from('data-bytes'), 'image/png');
      const { id: fileId, publicSlug: slug } = up.json().file;
      expect((await app.inject({ method: 'GET', url: `/p/${slug}` })).statusCode).toBe(200);
      await app.inject({ method: 'DELETE', url: `/files/${fileId}`, headers: authHeaders(auth) });
      expect((await app.inject({ method: 'GET', url: `/p/${slug}` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/p/doesnotexist' })).statusCode).toBe(404);
    });

    it('refuses a folder that is both public and zero-knowledge', async () => {
      await createUser({ email: 'pub4@test.local', password: 'correct-horse-battery' });
      const auth = await login(app, 'pub4@test.local', 'correct-horse-battery');
      const res = await app.inject({
        method: 'POST',
        url: '/folders',
        headers: authHeaders(auth),
        payload: { name: 'bad', isPublic: true, isZeroKnowledge: true },
      });
      expect(res.statusCode).toBe(400);
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
