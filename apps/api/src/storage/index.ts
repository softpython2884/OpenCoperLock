import { randomBytes } from 'node:crypto';
import type { Env } from '../env.js';
import { LocalStorageDriver } from './local.js';
import type { StorageDriver } from './types.js';

export type { StorageDriver } from './types.js';

/** Build the configured storage driver. Only `local` ships today. */
export function createStorage(env: Env): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalStorageDriver(env.STORAGE_PATH, env.QUARANTINE_PATH);
    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${env.STORAGE_DRIVER}`);
  }
}

/**
 * Generate a sharded storage key. Two levels of 2-hex-char directories keep any
 * single directory from holding millions of entries.
 */
export function newStorageKey(): string {
  const id = randomBytes(16).toString('hex');
  return `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}`;
}
