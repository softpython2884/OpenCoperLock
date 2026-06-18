import { describe, expect, it } from 'vitest';
import {
  createFileCipher,
  createFileDecipher,
  generateDataKey,
  loadMasterKey,
  randomCode,
  safeEqual,
  sha256Hex,
  unwrapKey,
  wrapKey,
} from './crypto.js';

const masterKeyB64 = Buffer.alloc(32, 7).toString('base64');

describe('envelope key wrapping', () => {
  it('round-trips a data key through wrap/unwrap', () => {
    const master = loadMasterKey(masterKeyB64);
    const dek = generateDataKey();
    const wrapped = wrapKey(dek, master);
    expect(unwrapKey(wrapped, master).equals(dek)).toBe(true);
  });

  it('rejects a tampered wrapped key', () => {
    const master = loadMasterKey(masterKeyB64);
    const wrapped = wrapKey(generateDataKey(), master);
    const bytes = Buffer.from(wrapped, 'base64');
    bytes[bytes.length - 1] ^= 0xff; // flip a ciphertext bit
    expect(() => unwrapKey(bytes.toString('base64'), master)).toThrow();
  });

  it('rejects an invalid master key length', () => {
    expect(() => loadMasterKey(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('file content encryption', () => {
  it('encrypts and decrypts file bytes via the GCM cipher pair', () => {
    const dek = generateDataKey();
    const plaintext = Buffer.from('the quick brown fox jumps over the lazy dog'.repeat(100));

    const { iv, cipher } = createFileCipher(dek);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const decipher = createFileDecipher(dek, iv, tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    expect(decrypted.equals(plaintext)).toBe(true);
    expect(ciphertext.equals(plaintext)).toBe(false);
  });

  it('fails to decrypt with the wrong key', () => {
    const { iv, cipher } = createFileCipher(generateDataKey());
    const ciphertext = Buffer.concat([cipher.update(Buffer.from('secret')), cipher.final()]);
    const tag = cipher.getAuthTag();
    const decipher = createFileDecipher(generateDataKey(), iv, tag);
    expect(() => Buffer.concat([decipher.update(ciphertext), decipher.final()])).toThrow();
  });
});

describe('helpers', () => {
  it('sha256Hex is stable', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('safeEqual compares correctly', () => {
    expect(safeEqual('token', 'token')).toBe(true);
    expect(safeEqual('token', 'tokeN')).toBe(false);
    expect(safeEqual('a', 'ab')).toBe(false);
  });

  it('randomCode avoids ambiguous characters', () => {
    const code = randomCode(40);
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
    expect(code).toHaveLength(40);
  });
});
