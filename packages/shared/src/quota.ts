/**
 * Pure quota math, shared so the API enforces exactly what the UI previews.
 */

export interface QuotaCheckInput {
  /** Bytes the user already stores. */
  usedBytes: number;
  /** The user's personal quota in bytes; null = unlimited. */
  userQuotaBytes: number | null;
  /** Total bytes stored across all users. */
  globalUsedBytes: number;
  /** Deployment-wide cap in bytes; 0 = unlimited. */
  globalCapBytes: number;
  /** Size of the incoming upload in bytes. */
  incomingBytes: number;
}

export type QuotaDenyReason = 'USER_QUOTA_EXCEEDED' | 'GLOBAL_CAP_EXCEEDED';

export interface QuotaResult {
  allowed: boolean;
  reason?: QuotaDenyReason;
}

/**
 * Decide whether an upload of `incomingBytes` fits within both the user's quota
 * and the global cap. The user quota is checked first so the error is specific.
 */
export function checkQuota(input: QuotaCheckInput): QuotaResult {
  const { usedBytes, userQuotaBytes, globalUsedBytes, globalCapBytes, incomingBytes } = input;

  if (userQuotaBytes !== null && usedBytes + incomingBytes > userQuotaBytes) {
    return { allowed: false, reason: 'USER_QUOTA_EXCEEDED' };
  }
  if (globalCapBytes > 0 && globalUsedBytes + incomingBytes > globalCapBytes) {
    return { allowed: false, reason: 'GLOBAL_CAP_EXCEEDED' };
  }
  return { allowed: true };
}

/** Format a byte count into a human-friendly string (binary units). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}
