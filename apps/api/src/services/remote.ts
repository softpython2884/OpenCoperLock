/**
 * Remote-Upload downloader. Fetches a user-supplied URL *server-side* so a phone on
 * 4G/5G never has to relay the bytes. Security-critical: this is an SSRF sink, so we
 *   - allow only http/https,
 *   - manually follow redirects, re-validating every hop,
 *   - DNS-resolve each host, reject any private/reserved address, and then PIN the
 *     connection to the exact validated IP (closing the DNS-rebinding window between
 *     our lookup and the connect),
 *   - cap the response size.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { Agent } from 'undici';
import { assertAllowedUrl, isPrivateAddress, SsrfError } from '@opencoperlock/shared';

const MAX_REDIRECTS = 5;

/**
 * Resolve a host, ensure every address is public, and return one validated address to
 * connect to. Literal IPs are returned as-is (already checked by assertAllowedUrl).
 */
async function resolvePublicAddress(hostname: string): Promise<string> {
  if (isIP(hostname)) return hostname;
  const records = await lookup(hostname, { all: true });
  if (records.length === 0) throw new SsrfError('Host does not resolve');
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new SsrfError('Host resolves to a private or reserved address');
    }
  }
  return records[0]!.address;
}

/**
 * An undici dispatcher whose DNS lookup is pinned to a single, pre-validated IP. The TLS
 * SNI / Host header still use the original hostname, so certificate validation is intact;
 * only the TCP target is fixed — a rebinding response after our check cannot redirect us
 * to an internal address.
 */
function pinnedDispatcher(ip: string): Agent {
  const family = isIP(ip);
  return new Agent({
    connect: {
      // undici calls this dns.lookup-style; honour both the `all` and single-result forms.
      lookup(_hostname, options, callback) {
        if (options && (options as { all?: boolean }).all) {
          callback(null, [{ address: ip, family }] as never);
        } else {
          (callback as (err: Error | null, address: string, family: number) => void)(null, ip, family);
        }
      },
    },
  });
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

/** Raised for HTTP statuses; carries the code so the worker can decide whether to retry. */
export class RemoteHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Remote server returned ${status}`);
    this.name = 'RemoteHttpError';
  }
}

/**
 * Open a validated, redirect-safe stream for `rawUrl`. Returns a Node Readable plus
 * the inferred filename and content type. Throws SsrfError on any policy violation.
 *
 * `timeoutMs` bounds the whole transfer: the AbortSignal it builds aborts not only a slow
 * connect but also a stalled body read, so a hung remote can never wedge the worker.
 */
export async function openRemoteSource(
  rawUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<RemoteSource> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 5 * 60 * 1000);
  let current = assertAllowedUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const pinnedIp = await resolvePublicAddress(current.hostname);
    // `dispatcher` is an undici extension to global fetch; not in the DOM RequestInit type.
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': 'OpenCoperLock-RemoteUpload/0.1' },
      signal,
      dispatcher: pinnedDispatcher(pinnedIp),
    } as RequestInit & { dispatcher: Agent });

    // Manual redirect handling so we re-validate each Location.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new SsrfError('Redirect without Location header');
      current = assertAllowedUrl(new URL(location, current).toString());
      continue;
    }

    if (!res.ok || !res.body) {
      throw new RemoteHttpError(res.status);
    }

    return {
      body: Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      filename: filenameFrom(current, res.headers.get('content-disposition')),
      mimeType: res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
    };
  }

  throw new SsrfError('Too many redirects');
}
