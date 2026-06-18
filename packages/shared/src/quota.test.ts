import { describe, expect, it } from 'vitest';
import { checkQuota, formatBytes } from './quota.js';

describe('checkQuota', () => {
  const base = {
    usedBytes: 0,
    userQuotaBytes: 1000,
    globalUsedBytes: 0,
    globalCapBytes: 5000,
    incomingBytes: 100,
  };

  it('allows an upload within both limits', () => {
    expect(checkQuota(base)).toEqual({ allowed: true });
  });

  it('denies when the user quota would be exceeded', () => {
    expect(checkQuota({ ...base, usedBytes: 950 })).toEqual({
      allowed: false,
      reason: 'USER_QUOTA_EXCEEDED',
    });
  });

  it('denies when the global cap would be exceeded', () => {
    expect(checkQuota({ ...base, globalUsedBytes: 4950 })).toEqual({
      allowed: false,
      reason: 'GLOBAL_CAP_EXCEEDED',
    });
  });

  it('treats null user quota and 0 global cap as unlimited', () => {
    expect(
      checkQuota({
        usedBytes: 1e12,
        userQuotaBytes: null,
        globalUsedBytes: 1e12,
        globalCapBytes: 0,
        incomingBytes: 1e9,
      }),
    ).toEqual({ allowed: true });
  });
});

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB');
    expect(formatBytes(10 * 1024 ** 3)).toBe('10.0 GiB');
  });
});
