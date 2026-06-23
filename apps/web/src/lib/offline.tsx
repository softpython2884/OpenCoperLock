'use client';

/**
 * Offline support. Tracks connectivity, lets the app queue file uploads while offline (stored in
 * IndexedDB), and flushes the queue automatically when the network returns — uploading to the
 * chosen folder (or the account's Fast-Upload folder), then clearing the local copies.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { FAST_UPLOAD_FOLDER_NAME } from '@opencoperlock/shared/client';
import { api, API_URL } from './api';
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

  // Real connectivity = can we actually reach the API, not just what navigator.onLine claims
  // (a misconfigured NIC or captive portal can lie). We probe /health with a short timeout and
  // use that as the source of truth; navigator events and a timer just trigger a re-probe.
  const onlineRef = useRef(true);
  const probe = useCallback(async (): Promise<boolean> => {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${API_URL}/health`, { method: 'GET', cache: 'no-store', credentials: 'omit', signal: ctrl.signal });
      clearTimeout(to);
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  const recheck = useCallback(async () => {
    const ok = await probe();
    const was = onlineRef.current;
    onlineRef.current = ok;
    setOnline(ok);
    if (ok && !was) void flush(); // transitioned offline → online
  }, [probe, flush]);

  useEffect(() => {
    void reloadItems();
    void recheck();
    const onEvt = () => void recheck();
    window.addEventListener('online', onEvt);
    window.addEventListener('offline', onEvt);
    const iv = setInterval(() => void recheck(), 25000);
    return () => {
      window.removeEventListener('online', onEvt);
      window.removeEventListener('offline', onEvt);
      clearInterval(iv);
    };
  }, [recheck, reloadItems]);

  const enqueueFiles = useCallback(
    async (files: FileList | File[], folderId: string, folderName: string) => {
      for (const file of Array.from(files)) {
        await enqueue({ blob: file, name: file.name, type: file.type, folderId, folderName, createdAt: Date.now() });
      }
      await reloadItems();
      // If we're actually reachable, try to flush right away.
      if (onlineRef.current) void flush();
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
