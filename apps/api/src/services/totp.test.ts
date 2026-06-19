import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, totpAt, verifyTotp } from './totp.js';

// RFC 6238 / RFC 4226 use the ASCII secret "12345678901234567890".
const SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('base32', () => {
  it('round-trips', () => {
    const buf = Buffer.from('hello world');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
  it('matches a known vector', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
});

describe('TOTP (RFC 6238 SHA-1, 6 digits)', () => {
  // Truncated 6-digit values of the published 8-digit SHA-1 test vectors.
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('time %i -> %s', (seconds, expected) => {
    expect(totpAt(SECRET, seconds * 1000)).toBe(expected);
  });

  it('verifies the current token and rejects a wrong one', () => {
    const now = 1111111109 * 1000;
    expect(verifyTotp(SECRET, '081804', now)).toBe(true);
    expect(verifyTotp(SECRET, '000000', now)).toBe(false);
    expect(verifyTotp(SECRET, 'abcdef', now)).toBe(false);
  });

  it('tolerates one step of clock skew', () => {
    const base = 1111111109 * 1000;
    // Token from the previous step verifies within the ±1 window.
    const prev = totpAt(SECRET, base - 30_000);
    expect(verifyTotp(SECRET, prev, base)).toBe(true);
  });
});
