/**
 * Parse the TRUST_PROXY env value into the form Fastify's `trustProxy` option expects.
 * See env.ts for the accepted values and why correct client-IP derivation matters behind
 * an nginx reverse proxy.
 */
export function parseTrustProxy(value: string): boolean | number | string[] {
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  // Comma-separated list of trusted proxy IPs / subnets.
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
