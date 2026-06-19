/**
 * Pure brute-force backoff math, shared so the policy is auditable and testable in
 * isolation from the database. The API's throttle service applies these durations to
 * persisted failure counters (see apps/api/src/services/throttle.ts).
 */

export interface ThrottlePolicy {
  /** Failures allowed within the window before any lock applies. */
  maxFailures: number;
  /** Sliding window after which an idle counter is forgotten, in ms. */
  windowMs: number;
  /** Lock duration applied at the threshold, doubled for each further failure. */
  baseLockMs: number;
  /** Upper bound on a single lock, in ms. */
  maxLockMs: number;
}

/**
 * Lock duration for the current failure count. Returns 0 below the threshold, then grows
 * exponentially (baseLockMs, 2x, 4x, …) capped at maxLockMs.
 */
export function lockDurationMs(failures: number, policy: ThrottlePolicy): number {
  if (failures < policy.maxFailures) return 0;
  const over = failures - policy.maxFailures; // 0 at the threshold, then 1, 2, …
  const ms = policy.baseLockMs * 2 ** over;
  return Math.min(ms, policy.maxLockMs);
}

/** Login policy: 5 tries, then 1 min lock doubling up to 1 hour, window 15 min. */
export const LOGIN_THROTTLE: ThrottlePolicy = {
  maxFailures: 5,
  windowMs: 15 * 60 * 1000,
  baseLockMs: 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
};

/**
 * Quick-Upload password policy: deliberately gentle so a legitimate guest who fat-fingers
 * the password isn't punished, but a guesser is. 4 tries, then 2 min lock doubling up to
 * 30 min, window 30 min.
 */
export const QUICK_THROTTLE: ThrottlePolicy = {
  maxFailures: 4,
  windowMs: 30 * 60 * 1000,
  baseLockMs: 2 * 60 * 1000,
  maxLockMs: 30 * 60 * 1000,
};
