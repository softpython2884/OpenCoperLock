/**
 * IndexedDB-backed queue of files picked while offline. Each item keeps the file blob and the
 * chosen destination; the OfflineProvider flushes them (uploads + removes) when the network
 * returns. Blobs live in IndexedDB so they survive a reload/restart while offline.
 */
const DB_NAME = 'ocl-offline';
const STORE = 'queue';

export interface QueuedItem {
  id?: number;
  blob: Blob;
  name: string;
  type: string;
  /** Target folder id, or '' to let the flush pick the Fast-Upload folder. */
  folderId: string;
  folderName: string;
  createdAt: number;
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

export function removeQueued(id: number): Promise<void> {
  return tx<void>('readwrite', (s) => s.delete(id));
}

export async function queueCount(): Promise<number> {
  return tx<number>('readonly', (s) => s.count());
}
