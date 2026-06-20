/**
 * @type {import('next').NextConfig}
 *
 * Security headers including a Content-Security-Policy. The policy is deliberately tight:
 * no external origins, framing denied, object/base locked down. `connect-src` is widened
 * to the API origin so the SPA can reach it cross-subdomain; same-origin `/api` topologies
 * are already covered by 'self'. Script/style keep 'unsafe-inline' because Next's hydration
 * and Tailwind inject inline content — moving to nonce-based CSP is a planned hardening.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
let apiOrigin = '';
try {
  apiOrigin = new URL(apiUrl).origin;
} catch {
  apiOrigin = '';
}

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Share previews + the in-app viewer stream image/audio/video/pdf from the API origin or
  // a client-side blob: URL (e.g. decrypted Zero-Knowledge files, the PDF viewer iframe).
  `img-src 'self' data: blob: ${apiOrigin}`.trim(),
  `media-src 'self' blob: ${apiOrigin}`.trim(),
  `frame-src 'self' blob: ${apiOrigin}`.trim(),
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${apiOrigin}`.trim(),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@opencoperlock/shared'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
