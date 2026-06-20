import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy', () => {
  it('treats empty/false as no trust', () => {
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('FALSE')).toBe(false);
  });
  it('treats true as full trust', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });
  it('parses a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('3')).toBe(3);
  });
  it('parses a list of subnets', () => {
    expect(parseTrustProxy('127.0.0.1, ::1 , 10.0.0.0/8')).toEqual(['127.0.0.1', '::1', '10.0.0.0/8']);
  });
});
