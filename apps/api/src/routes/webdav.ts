/**
 * Minimal WebDAV (class 1 + stubbed locks) so the Drive can be mounted as a network drive
 * (Finder, Windows Explorer, rsync/davfs, Cyberduck…). Normal (server-encrypted) folders only —
 * Zero-Knowledge vaults are decrypted in the browser and can't be served here.
 *
 * Auth is HTTP Basic where the PASSWORD is a personal API token (`ocl_…`); the username is
 * ignored. Read methods need the token's `read` scope, writes need `write`. Folder-restricted
 * tokens are refused — WebDAV exposes the whole account tree.
 *
 * This module is mounted OUTSIDE the CORS scope: @fastify/cors uses strictPreflight and would
 * answer every WebDAV OPTIONS with 400/204, hiding the DAV capability headers clients rely on.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import type { FileObject, Folder } from '@prisma/client';
import { prisma } from '../db.js';
import { authenticateToken } from '../services/apiToken.js';
import { decryptServerFile } from '../services/download.js';
import { storeUserFile, QuotaExhaustedError } from '../services/upload.js';
import { FileTooLargeError, InfectedFileError } from '../services/ingest.js';
import { trashFile, trashFolder } from '../services/trash.js';
import { remainingAllowance } from '../services/quota.js';

const PREFIX = '/dav';
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PROPFIND']);

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Absolute href for a path, with a trailing slash for collections. `base` is the public path to
 *  the WebDAV root (e.g. "/dav", or "/api/dav" behind a proxy), so links work through nginx. */
export function hrefFor(base: string, segments: string[], isCollection: boolean): string {
  const encoded = segments.map((s) => encodeURIComponent(s)).join('/');
  const full = encoded ? `${base}/${encoded}` : base;
  return isCollection ? `${full}/` : full;
}

/** Split a WebDAV request path (the part after /dav) into decoded, non-empty segments. */
export function pathSegments(star: string | undefined): string[] {
  return (star ?? '')
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

/** Public path to the WebDAV root, honouring a reverse-proxy prefix (X-Forwarded-Prefix) so the
 *  hrefs we emit match the URL the client actually used (e.g. /api/dav behind nginx). */
function davBase(req: FastifyRequest): string {
  const fwd = String(req.headers['x-forwarded-prefix'] ?? '').trim().replace(/\/+$/, '');
  return `${fwd}${PREFIX}`;
}

type Resolved =
  | { type: 'root' }
  | { type: 'folder'; folder: Folder; parentId: string | null }
  | { type: 'file'; file: FileObject; parentId: string | null }
  | { type: 'missing'; parentId: string | null; name: string }
  | { type: 'invalid' };

/** Walk a path's segments, matching folders by name; the last may be a file. */
async function resolvePath(ownerId: string, segments: string[]): Promise<Resolved> {
  if (segments.length === 0) return { type: 'root' };
  let parentId: string | null = null;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const folder: Folder | null = await prisma.folder.findFirst({
      where: { ownerId, parentId, name: segments[i], isZeroKnowledge: false },
    });
    if (!folder) return { type: 'invalid' };
    parentId = folder.id;
  }
  const last = segments[segments.length - 1]!;
  const folder = await prisma.folder.findFirst({ where: { ownerId, parentId, name: last, isZeroKnowledge: false } });
  if (folder) return { type: 'folder', folder, parentId };
  const file = await prisma.fileObject.findFirst({
    where: { ownerId, folderId: parentId, name: last, encMode: 'SERVER', deletedAt: null },
  });
  if (file) return { type: 'file', file, parentId };
  return { type: 'missing', parentId, name: last };
}

function propXml(
  base: string,
  segments: string[],
  isCollection: boolean,
  name: string,
  size: number,
  mtime: Date,
  mime: string,
  quota?: { used: number; available: number },
): string {
  // RFC 4331 quota props make the OS show the account quota (not the server disk) on the mount.
  const quotaXml = quota
    ? `<D:quota-available-bytes>${quota.available}</D:quota-available-bytes><D:quota-used-bytes>${quota.used}</D:quota-used-bytes>`
    : '';
  const props = isCollection
    ? `<D:resourcetype><D:collection/></D:resourcetype>${quotaXml}`
    : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength><D:getcontenttype>${escapeXml(mime)}</D:getcontenttype>`;
  return (
    `<D:response><D:href>${escapeXml(hrefFor(base, segments, isCollection))}</D:href>` +
    `<D:propstat><D:prop>` +
    `<D:displayname>${escapeXml(name)}</D:displayname>` +
    `<D:getlastmodified>${mtime.toUTCString()}</D:getlastmodified>` +
    props +
    `</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`
  );
}

export const webdavRoutes: FastifyPluginAsync = async (app) => {
  // Pass request bodies through as raw streams (PUT) and accept any content type (PROPFIND XML).
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

  const challenge = (reply: FastifyReply) =>
    reply.code(401).header('WWW-Authenticate', 'Basic realm="OpenCoperLock WebDAV"').send();

  async function auth(req: FastifyRequest, reply: FastifyReply): Promise<{ ownerId: string } | null> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Basic ')) {
      challenge(reply);
      return null;
    }
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const token = pass || user; // clients put the token in the password field
    const scope = READ_METHODS.has(req.method) ? 'read' : 'write';
    const result = await authenticateToken(`Bearer ${token}`, scope);
    if (!result.ok) {
      challenge(reply);
      return null;
    }
    if (result.token.folderId) {
      reply.code(403).send('Use an unrestricted API token for WebDAV');
      return null;
    }
    return { ownerId: result.owner.id };
  }

  // A Destination header is an absolute URL or path; reduce it to /dav segments.
  function destinationSegments(dest: string | undefined): string[] | null {
    if (!dest) return null;
    let path = dest;
    try {
      path = new URL(dest).pathname;
    } catch {
      /* already a path */
    }
    const i = path.indexOf(PREFIX);
    if (i < 0) return null;
    return pathSegments(path.slice(i + PREFIX.length));
  }

  async function handle(req: FastifyRequest, reply: FastifyReply) {
    const principal = await auth(req, reply);
    if (!principal) return;
    const ownerId = principal.ownerId;
    const segments = pathSegments((req.params as Record<string, string>)['*']);
    const method = req.method;

    if (method === 'OPTIONS') {
      return reply
        .header('DAV', '1, 2')
        .header('MS-Author-Via', 'DAV')
        .header('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK')
        .code(204)
        .send();
    }

    const node = await resolvePath(ownerId, segments);

    const base = davBase(req);

    if (method === 'PROPFIND') {
      if (node.type === 'invalid' || node.type === 'missing') return reply.code(404).send();
      const depth = String(req.headers.depth ?? '1');
      const parts: string[] = [];
      // Report the account quota on the queried collection so the mount shows the right size.
      let quota: { used: number; available: number } | undefined;
      if (node.type !== 'file') {
        const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { usedBytes: true } });
        const avail = await remainingAllowance(ownerId);
        quota = {
          used: Number(user?.usedBytes ?? 0n),
          available: Number.isFinite(avail) ? Math.max(0, Math.floor(avail)) : 1_099_511_627_776, // 1 TiB if unlimited
        };
      }
      if (node.type === 'root') {
        parts.push(propXml(base, [], true, 'OpenCoperLock', 0, new Date(), '', quota));
      } else if (node.type === 'folder') {
        parts.push(propXml(base, segments, true, node.folder.name, 0, node.folder.createdAt, '', quota));
      } else {
        parts.push(propXml(base, segments, false, node.file.name, Number(node.file.sizeBytes), node.file.createdAt, node.file.mimeType));
      }
      if (depth !== '0' && node.type !== 'file') {
        const parentId = node.type === 'root' ? null : node.folder.id;
        const [folders, files] = await Promise.all([
          prisma.folder.findMany({ where: { ownerId, parentId, isZeroKnowledge: false }, orderBy: { name: 'asc' } }),
          prisma.fileObject.findMany({
            where: { ownerId, folderId: parentId, encMode: 'SERVER', deletedAt: null },
            orderBy: { name: 'asc' },
          }),
        ]);
        for (const f of folders) parts.push(propXml(base, [...segments, f.name], true, f.name, 0, f.createdAt, ''));
        for (const f of files) parts.push(propXml(base, [...segments, f.name], false, f.name, Number(f.sizeBytes), f.createdAt, f.mimeType));
      }
      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .code(207)
        .send(`<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">${parts.join('')}</D:multistatus>`);
    }

    if (method === 'GET' || method === 'HEAD') {
      if (node.type !== 'file') return reply.code(node.type === 'folder' || node.type === 'root' ? 405 : 404).send();
      reply
        .header('Content-Type', node.file.mimeType)
        .header('Content-Length', Number(node.file.sizeBytes))
        .header('Last-Modified', node.file.createdAt.toUTCString())
        .header('Accept-Ranges', 'none');
      if (method === 'HEAD') return reply.send();
      return reply.send(decryptServerFile(app.ctx, node.file));
    }

    if (method === 'PUT') {
      if (node.type === 'folder' || node.type === 'root') return reply.code(405).send();
      if (node.type === 'invalid') return reply.code(409).send(); // a parent folder is missing
      const parentId = node.type === 'file' ? node.file.folderId : node.parentId;
      const name = node.type === 'file' ? node.file.name : node.name;
      const mimetype = String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
      try {
        await storeUserFile(app.ctx, { ownerId, folderId: parentId, stream: req.body as Readable, filename: name, mimetype });
      } catch (err) {
        if (err instanceof QuotaExhaustedError || err instanceof FileTooLargeError) return reply.code(507).send(); // Insufficient Storage
        if (err instanceof InfectedFileError) return reply.code(403).send('File rejected by antivirus');
        throw err;
      }
      return reply.code(node.type === 'file' ? 204 : 201).send();
    }

    if (method === 'MKCOL') {
      if (node.type !== 'missing') return reply.code(node.type === 'invalid' ? 409 : 405).send();
      await prisma.folder.create({ data: { ownerId, name: node.name, parentId: node.parentId, isZeroKnowledge: false } });
      return reply.code(201).send();
    }

    if (method === 'DELETE') {
      if (node.type === 'file') await trashFile(ownerId, node.file.id);
      else if (node.type === 'folder') await trashFolder(ownerId, node.folder.id);
      else return reply.code(404).send();
      return reply.code(204).send();
    }

    if (method === 'MOVE') {
      if (node.type !== 'file' && node.type !== 'folder') return reply.code(404).send();
      const destSegs = destinationSegments(req.headers.destination as string | undefined);
      if (!destSegs || destSegs.length === 0) return reply.code(400).send();
      const destParent = await resolvePath(ownerId, destSegs.slice(0, -1));
      const destParentId =
        destParent.type === 'root' ? null : destParent.type === 'folder' ? destParent.folder.id : undefined;
      if (destParentId === undefined) return reply.code(409).send();
      const destName = destSegs[destSegs.length - 1]!;
      const existing = await resolvePath(ownerId, destSegs);
      if (existing.type === 'file' || existing.type === 'folder') {
        if (String(req.headers.overwrite ?? 'T').toUpperCase() === 'F') return reply.code(412).send();
        if (existing.type === 'file') await trashFile(ownerId, existing.file.id);
        else await trashFolder(ownerId, existing.folder.id);
      }
      if (node.type === 'file') {
        await prisma.fileObject.update({ where: { id: node.file.id }, data: { folderId: destParentId, name: destName } });
      } else {
        await prisma.folder.update({ where: { id: node.folder.id }, data: { parentId: destParentId, name: destName } });
      }
      return reply.code(existing.type === 'file' || existing.type === 'folder' ? 204 : 201).send();
    }

    // Stubbed locking so Finder / Office clients are happy (we are single-writer in practice).
    if (method === 'LOCK') {
      const token = `opaquelocktoken:${crypto.randomUUID()}`;
      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Lock-Token', `<${token}>`)
        .code(200)
        .send(
          `<?xml version="1.0" encoding="utf-8"?>\n<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>` +
            `<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>` +
            `<D:depth>infinity</D:depth><D:timeout>Second-3600</D:timeout>` +
            `<D:locktoken><D:href>${token}</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`,
        );
    }
    if (method === 'UNLOCK') return reply.code(204).send();
    if (method === 'PROPPATCH') {
      // Pretend property writes (e.g. mtime) succeed so clients don't abort the transfer.
      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .code(207)
        .send(
          `<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:"><D:response>` +
            `<D:href>${escapeXml(hrefFor(base, segments, node.type === 'folder' || node.type === 'root'))}</D:href>` +
            `<D:propstat><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
        );
    }
    if (method === 'COPY') return reply.code(501).send('COPY is not supported');

    return reply.code(405).send();
  }

  const methods = [
    'OPTIONS',
    'GET',
    'PUT',
    'DELETE',
    'PROPFIND',
    'PROPPATCH',
    'MKCOL',
    'MOVE',
    'COPY',
    'LOCK',
    'UNLOCK',
  ];
  for (const method of methods) {
    // HEAD is intentionally omitted: Fastify auto-creates a HEAD route from each GET route and
    // reuses this handler (which special-cases method === 'HEAD'). Registering HEAD explicitly
    // would collide with that auto route (FST_ERR_DUPLICATED_ROUTE on boot).
    app.route({ method: method as never, url: '/', handler: handle });
    app.route({ method: method as never, url: '/*', handler: handle });
  }
};
