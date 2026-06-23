'use client';

/**
 * Offline support. Tracks connectivity, lets the app queue file uploads while offline (stored in
 * IndexedDB), and flushes the queue automatically when the network returns — uploading to the
 * chosen folder (or the account's Fast-Upload folder), then clearing the local copies.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { FAST_UPLOAD_FOLDER_NAME } from '@opencoperlock/shared/client';
import { api } from './api';
import { useAuth } from './auth';
import { useT } from './i18n';
import { toast } from '@/components/ui/overlays';
import { allQueued, enqueue, removeQueued, type QueuedItem } from './offlineQueue';

interface OfflineCtx {
  online: boolean;
  items: QueuedItem[];
  enqueueFiles: (files: FileList | File[], folderId: string, folderName: string) => Promise<void>;
  removeItem: (id: number) => Promise<void>;
  flush: () => Promise<void>;
}

const Ctx = createContext<OfflineCtx | null>(null);
export const useOffline = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOffline must be used within OfflineProvider');
  return c;
};

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { refresh } = useAuth();
  const { t } = useT();
  const [online, setOnline] = useState(true);
  const [items, setItems] = useState<QueuedItem[]>([]);
  const flushing = useRef(false);

  const reloadItems = useCallback(async () => {
    try {
      setItems(await allQueued());
    } catch {
      /* IndexedDB unavailable */
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const queued = await allQueued();
      if (queued.length === 0) return;
      // Restore the in-memory CSRF token (lost on reload) before any mutating upload.
      try {
        await refresh();
      } catch {
        /* may still have a valid token */
      }
      // Resolve the Fast-Upload folder as the default destination.
      let fastId = '';
      try {
        const res = await api.get<{ folders: { id: string; name: string; isZeroKnowledge: boolean }[] }>('/folders');
        fastId = res.folders.find((f) => f.name === FAST_UPLOAD_FOLDER_NAME && !f.isZeroKnowledge)?.id ?? '';
      } catch {
        return; // network dropped again — keep everything queued
      }
      let done = 0;
      for (const it of queued) {
        const target = it.folderId || fastId;
        const form = new FormData();
        form.append('file', new File([it.blob], it.name, { type: it.type || 'application/octet-stream' }));
        try {
          await api.upload(target ? `/files?folderId=${encodeURIComponent(target)}` : '/files', form);
          if (it.id != null) await removeQueued(it.id);
          done += 1;
        } catch {
          /* keep this one queued for the next attempt */
        }
      }
      await reloadItems();
      if (done > 0) toast(t('offline.synced', { n: done }), 'success');
    } finally {
      flushing.current = false;
    }
  }, [refresh, reloadItems, t]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void reloadItems();
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    // Catch a connection that came back before this mounted.
    if (navigator.onLine) void flush();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [flush, reloadItems]);

  const enqueueFiles = useCallback(
    async (files: FileList | File[], folderId: string, folderName: string) => {
      for (const file of Array.from(files)) {
        await enqueue({ blob: file, name: file.name, type: file.type, folderId, folderName, createdAt: Date.now() });
      }
      await reloadItems();
      // If we're actually online (e.g. flaky), try to flush right away.
      if (navigator.onLine) void flush();
    },
    [reloadItems, flush],
  );

  const removeItem = useCallback(
    async (id: number) => {
      await removeQueued(id);
      await reloadItems();
    },
    [reloadItems],
  );

  return <Ctx.Provider value={{ online, items, enqueueFiles, removeItem, flush }}>{children}</Ctx.Provider>;
}
