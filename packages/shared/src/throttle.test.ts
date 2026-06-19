import { describe, expect, it } from 'vitest';
import { lockDurationMs, LOGIN_THROTTLE, type ThrottlePolicy } from './throttle.js';

const policy: ThrottlePolicy = {
  maxFailures: 3,
  windowMs: 60_000,
  baseLockMs: 1_000,
  maxLockMs: 8_000,
};

describe('lockDurationMs', () => {
  it('does not lock below the threshold', () => {
    expect(lockDurationMs(0, policy)).toBe(0);
    expect(lockDurationMs(2, policy)).toBe(0);
  });

  it('applies the base lock at the threshold and doubles after', () => {
    expect(lockDurationMs(3, policy)).toBe(1_000);
    expect(lockDurationMs(4, policy)).toBe(2_000);
    expect(lockDurationMs(5, policy)).toBe(4_000);
  });

  it('caps at maxLockMs', () => {
    expect(lockDurationMs(6, policy)).toBe(8_000);
    expect(lockDurationMs(20, policy)).toBe(8_000);
  });

  it('login policy locks after 5 failures', () => {
    expect(lockDurationMs(4, LOGIN_THROTTLE)).toBe(0);
    expect(lockDurationMs(5, LOGIN_THROTTLE)).toBe(LOGIN_THROTTLE.baseLockMs);
  });
});
