import { describe, expect, it } from 'vitest';
import { assertAllowedUrl, isPrivateAddress, SsrfError } from './ssrf.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.5.4',
    '192.168.0.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ])('flags %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows public address %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );

  it('fails closed on non-IP input', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('assertAllowedUrl', () => {
  it('accepts a plain https URL', () => {
    expect(() => assertAllowedUrl('https://example.com/file.zip')).not.toThrow();
  });

  it.each([
    'ftp://example.com/x',
    'file:///etc/passwd',
    'http://localhost/admin',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://user:pass@example.com/',
    'gopher://example.com',
  ])('rejects %s', (url) => {
    expect(() => assertAllowedUrl(url)).toThrow(SsrfError);
  });
});
