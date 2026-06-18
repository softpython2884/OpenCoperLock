/**
 * SSRF guard for the Remote-Upload feature.
 *
 * Remote-Upload asks the server to fetch an arbitrary user-supplied URL. Without
 * guarding, that is a textbook Server-Side Request Forgery primitive: an attacker
 * could point it at `http://169.254.169.254/` (cloud metadata), internal admin
 * panels, or `localhost` services. We therefore:
 *   1. allow only http/https,
 *   2. resolve the hostname and reject any address in a private / reserved range.
 *
 * `assertPublicUrl` must be re-run after every redirect hop by the caller.
 */
import { isIP } from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

/** Parse a 4-octet dotted IPv4 string into a 32-bit number. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

/** True if an IPv4 address is private, loopback, link-local, or otherwise reserved. */
export function isPrivateIPv4(ip: string): boolean {
  const v = ipv4ToInt(ip);
  if (v === null) return true; // fail closed
  const inRange = (base: string, maskBits: number): boolean => {
    const baseInt = ipv4ToInt(base)!;
    const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
    return (v & mask) === (baseInt & mask);
  };
  return (
    inRange('0.0.0.0', 8) || // "this" network
    inRange('10.0.0.0', 8) || // private
    inRange('100.64.0.0', 10) || // CGNAT
    inRange('127.0.0.0', 8) || // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. cloud metadata)
    inRange('172.16.0.0', 12) || // private
    inRange('192.0.0.0', 24) ||
    inRange('192.168.0.0', 16) || // private
    inRange('198.18.0.0', 15) || // benchmarking
    inRange('224.0.0.0', 4) || // multicast
    inRange('240.0.0.0', 4) // reserved
  );
}

/** True if an IPv6 address is loopback, link-local, unique-local, or maps to a private IPv4. */
export function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]!; // strip zone id
  if (addr === '::1' || addr === '::') return true;
  if (addr.startsWith('fe80') || addr.startsWith('fc') || addr.startsWith('fd')) return true;
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

/** True if the address (v4 or v6) must not be reached by Remote-Upload. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // not a literal IP -> fail closed
}

/**
 * Validate the *scheme and shape* of a Remote-Upload URL. DNS resolution of the
 * host (and the per-address private-range check) is performed by the caller via
 * {@link isPrivateAddress} after lookup, because resolution is environment-specific.
 */
export function assertAllowedUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('Only http and https URLs are allowed');
  }
  if (!url.hostname) {
    throw new SsrfError('URL has no host');
  }
  // Reject credentials in URL and obvious localhost aliases early.
  if (url.username || url.password) {
    throw new SsrfError('Credentials in URL are not allowed');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfError('Localhost is not allowed');
  }
  // If the host is a literal IP, we can check it right away.
  if (isIP(host) && isPrivateAddress(host)) {
    throw new SsrfError('Target address is in a private or reserved range');
  }
  return url;
}
