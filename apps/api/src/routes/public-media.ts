/**
 * Public media hosting for Public/Open spaces. Serves the PLAINTEXT bytes of a file at a stable,
 * unauthenticated URL — /p/<slug> (an optional trailing /<name> is cosmetic, so consumers that
 * sniff the extension are happy). Built for embedding raw images/videos on other sites:
 *
 *   - no auth, no decryption → fast;
 *   - HTTP range requests (206) so <video>/<audio> seeking works;
 *   - long immutable caching (each slug maps to one, never-rewritten blob) + ETag revalidation;
 *   - permissive CORS (Access-Control-Allow-Origin: *) so cross-origin fetch/canvas use works too.
 *
 * Mounted OUTSIDE the browser CORS scope (like WebDAV) so the wildcard CORS here isn't overridden.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';

const ONE_YEAR = 31_536_000;

/** Parse a single-range `Range: bytes=…` header against a known size. Returns null if absent,
 *  or 'invalid' if present but unsatisfiable. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const n = Number(rawEnd);
    if (!n) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

export const publicMediaRoutes: FastifyPluginAsync = async (app) => {
  async function serve(req: FastifyRequest, reply: FastifyReply) {
    const { slug } = req.params as { slug: string };
    const file = await prisma.fileObject.findFirst({
      where: { publicSlug: slug, encMode: 'PUBLIC', deletedAt: null },
    });

    // Common headers (also on 404 so cross-origin callers get a clean answer). CORP must be
    // overridden to cross-origin, otherwise Helmet's global same-origin value blocks other sites
    // from embedding the media in <img>/<video>.
    reply.header('Access-Control-Allow-Origin', '*').header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!file) return reply.code(404).header('Cache-Control', 'no-store').send('Not found');

    const size = Number(file.sizeBytes);
    const etag = file.sha256 ? `"${file.sha256}"` : undefined;

    reply
      .header('Content-Type', file.mimeType)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`)
      .header('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
    if (etag) reply.header('ETag', etag);

    // Conditional request: unchanged → 304 (no body).
    if (etag && req.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }

    const range = parseRange(req.headers.range, size);
    if (range === 'invalid') {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send('Range Not Satisfiable');
    }

    if (range) {
      const length = range.end - range.start + 1;
      reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', length);
      if (req.method === 'HEAD') return reply.send();
      return reply.send(app.ctx.storage.createReadStream(file.storageKey, { start: range.start, end: range.end }));
    }

    reply.header('Content-Length', size);
    if (req.method === 'HEAD') return reply.send();
    return reply.send(app.ctx.storage.createReadStream(file.storageKey));
  }

  // Preflight for cross-origin fetch/XHR use (plain <img>/<video> loads need no preflight).
  const preflight = (_req: FastifyRequest, reply: FastifyReply) =>
    reply
      .header('Access-Control-Allow-Origin', '*')
      .header('Cross-Origin-Resource-Policy', 'cross-origin')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Max-Age', '86400')
      .code(204)
      .send();

  app.get('/:slug', serve);
  app.get('/:slug/:name', serve); // cosmetic filename (nice extension in the URL)
  app.options('/:slug', preflight);
  app.options('/:slug/:name', preflight);
};
