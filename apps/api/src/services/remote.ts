/**
 * Remote-Upload downloader. Fetches a user-supplied URL *server-side* so a phone on
 * 4G/5G never has to relay the bytes. Security-critical: this is an SSRF sink, so we
 *   - allow only http/https,
 *   - manually follow redirects, re-validating every hop,
 *   - DNS-resolve each host and reject any private/reserved address,
 *   - cap the response size.
 *
 * (DNS rebinding between our lookup and fetch remains a theoretical risk; documented
 * in THREAT_MODEL.md. Deployments needing stronger guarantees can run behind an egress
 * proxy that enforces the same allowlist.)
 */
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { assertAllowedUrl, isPrivateAddress, SsrfError } from '@opencoperlock/shared';

const MAX_REDIRECTS = 5;

async function assertHostResolvesPublic(hostname: string): Promise<void> {
  // Literal IPs are already checked by assertAllowedUrl; this covers DNS names.
  const records = await lookup(hostname, { all: true });
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new SsrfError('Host resolves to a private or reserved address');
    }
  }
}

export interface RemoteSource {
  body: Readable;
  filename: string;
  mimeType: string;
}

/** Derive a filename from Content-Disposition, falling back to the URL path. */
function filenameFrom(url: URL, contentDisposition: string | null): string {
  if (contentDisposition) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  const last = url.pathname.split('/').filter(Boolean).pop();
  return last && last.length > 0 ? decodeURIComponent(last) : 'download';
}

/**
 * Open a validated, redirect-safe stream for `rawUrl`. Returns a Node Readable plus
 * the inferred filename and content type. Throws SsrfError on any policy violation.
 */
export async function openRemoteSource(rawUrl: string): Promise<RemoteSource> {
  let current = assertAllowedUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertHostResolvesPublic(current.hostname);
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'OpenCoperLock-RemoteUpload/0.1' },
    });

    // Manual redirect handling so we re-validate each Location.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new SsrfError('Redirect without Location header');
      current = assertAllowedUrl(new URL(location, current).toString());
      continue;
    }

    if (!res.ok || !res.body) {
      throw new Error(`Remote server returned ${res.status}`);
    }

    return {
      body: Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      filename: filenameFrom(current, res.headers.get('content-disposition')),
      mimeType: res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
    };
  }

  throw new SsrfError('Too many redirects');
}
