import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers.js';
import { escapeXml, hrefFor, pathSegments } from '../src/routes/webdav.js';

describe('webdav helpers', () => {
  it('escapes XML special characters', () => {
    expect(escapeXml('a & b <c> "d" \'e\'')).toBe('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;');
  });

  it('builds hrefs with a trailing slash for collections and encoding', () => {
    expect(hrefFor('/dav', [], true)).toBe('/dav/');
    expect(hrefFor('/dav', ['Photos'], true)).toBe('/dav/Photos/');
    expect(hrefFor('/dav', ['a', 'b.txt'], false)).toBe('/dav/a/b.txt');
    expect(hrefFor('/dav', ['my folder'], true)).toBe('/dav/my%20folder/');
  });

  it('honours a reverse-proxy prefix so links work through nginx', () => {
    expect(hrefFor('/api/dav', ['Photos'], true)).toBe('/api/dav/Photos/');
    expect(hrefFor('/api/dav', [], true)).toBe('/api/dav/');
  });

  it('splits and decodes path segments', () => {
    expect(pathSegments('a/b/c')).toEqual(['a', 'b', 'c']);
    expect(pathSegments('a/%20x')).toEqual(['a', ' x']);
    expect(pathSegments('')).toEqual([]);
    expect(pathSegments(undefined)).toEqual([]);
  });
});

// A boot smoke-test needs no real database (these routes reject before any query), so give
// loadEnv a throwaway DATABASE_URL and always run it — this catches route-registration crashes
// (e.g. a duplicated HEAD route) that would otherwise only surface as a 502 in production.
process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/ocl_boot_check';

describe('webdav routing (boot smoke-test)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('boots: browser routes stay inside CORS and respond', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  // No auth header → challenge BEFORE any DB access. Proves the custom methods are routed and
  // that WebDAV sits outside the CORS scope (otherwise OPTIONS would be 400/204 from cors).
  it('challenges an unauthenticated OPTIONS /dav', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/dav' });
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('Basic');
  });

  it('routes the custom PROPFIND verb', async () => {
    const res = await app.inject({ method: 'PROPFIND', url: '/dav/' });
    expect(res.statusCode).toBe(401);
  });
});
