/**
 * IndexedDB-backed queue of pending uploads. It holds two kinds of items: files picked while
 * offline, and uploads that FAILED while online (network drop, server error, or not-enough-space).
 * The OfflineProvider retries them with backoff and clears each on success. Blobs live in
 * IndexedDB so a queued upload survives a reload/restart.
 */
const DB_NAME = 'ocl-offline';
const STORE = 'queue';

/** 'pending' = will be retried automatically; 'blocked' = paused (needs free space, or the target
 *  is gone) and only a manual retry will move it. */
export type QueueStatus = 'pending' | 'blocked';

export interface QueuedItem {
  id?: number;
  blob: Blob;
  name: string;
  type: string;
  /** Byte size, kept so the UI can show it without touching the blob. */
  size: number;
  /** Target folder id, or '' to let the flush pick the Fast-Upload folder. */
  folderId: string;
  folderName: string;
  createdAt: number;
  status: QueueStatus;
  /** Number of upload attempts so far. */
  attempts: number;
  /** Earliest time (ms) the next automatic retry may run (backoff). */
  nextRetryAt: number;
  /** Human-readable last failure reason, shown in the transfers panel. */
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export function enqueue(item: Omit<QueuedItem, 'id'>): Promise<number> {
  return tx<number>('readwrite', (s) => s.add(item));
}

export function allQueued(): Promise<QueuedItem[]> {
  return tx<QueuedItem[]>('readonly', (s) => s.getAll());
}

export function updateQueued(item: QueuedItem): Promise<void> {
  return tx<void>('readwrite', (s) => s.put(item));
}

export function removeQueued(id: number): Promise<void> {
  return tx<void>('readwrite', (s) => s.delete(id));
}

export async function queueCount(): Promise<number> {
  return tx<number>('readonly', (s) => s.count());
}
