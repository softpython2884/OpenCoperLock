'use client';

/**
 * Resilient upload queue + connectivity. Uploads that can't go through right now — picked while
 * offline, or that FAILED online (network blip, server error, not-enough-space) — are stored in
 * IndexedDB and retried automatically with backoff, so a big upload (an ISO, an archive) is never
 * lost to a hiccup. Items that need free space are PAUSED (not cancelled) until space is made or
 * the user retries them manually.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { FAST_UPLOAD_FOLDER_NAME } from '@opencoperlock/shared/client';
import { api, API_URL, ApiError } from './api';
import { useAuth } from './auth';
import { useT } from './i18n';
import { toast } from '@/components/ui/overlays';
import { allQueued, enqueue, removeQueued, updateQueued, type QueuedItem } from './offlineQueue';

interface OfflineCtx {
  online: boolean;
  items: QueuedItem[];
  /** Queue files (offline capture) for background upload. */
  enqueueFiles: (files: FileList | File[], folderId: string, folderName: string) => Promise<void>;
  /** Queue a single upload that just failed online, so it retries in the background. */
  enqueueForRetry: (
    file: File,
    folderId: string,
    folderName: string,
    opts?: { blocked?: boolean; error?: string },
  ) => Promise<void>;
  retryItem: (id: number) => Promise<void>;
  retryAll: () => Promise<void>;
  removeItem: (id: number) => Promise<void>;
  flush: () => Promise<void>;
}

const Ctx = createContext<OfflineCtx | null>(null);
export const useOffline = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOffline must be used within OfflineProvider');
  return c;
};

/** Exponential backoff that caps at 5 min — so a persistent failure keeps retrying every 5 min. */
function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.min(attempts, 4), 300_000);
}

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
    if (flushing.current || !onlineRef.current) return;
    flushing.current = true;
    try {
      const queued = await allQueued();
      const now = Date.now();
      const due = queued.filter((it) => it.status === 'pending' && it.nextRetryAt <= now);
      if (due.length === 0) return;
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
      for (const it of due) {
        const target = it.folderId || fastId;
        const form = new FormData();
        form.append('file', new File([it.blob], it.name, { type: it.type || 'application/octet-stream' }));
        try {
          await api.upload(target ? `/files?folderId=${encodeURIComponent(target)}` : '/files', form);
          if (it.id != null) await removeQueued(it.id);
          done += 1;
        } catch (err) {
          if (it.id == null) continue;
          const attempts = it.attempts + 1;
          const status = err instanceof ApiError ? err.status : 0;
          // 413/507 = not enough space (owner quota or server disk) → PAUSE, don't burn retries.
          // 404 = the target folder is gone; 4xx (bad/infected) won't succeed on retry → pause too.
          const paused = status === 413 || status === 507 || status === 404 || (status >= 400 && status < 500 && status !== 401 && status !== 403);
          await updateQueued({
            ...it,
            attempts,
            status: paused ? 'blocked' : 'pending',
            nextRetryAt: paused ? 0 : Date.now() + backoffMs(attempts),
            lastError: err instanceof ApiError ? err.message : t('offline.errNetwork'),
          });
        }
      }
      await reloadItems();
      if (done > 0) {
        toast(t('offline.synced', { n: done }), 'success');
        // Let any open Drive view refresh so the newly-uploaded files appear.
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ocl:queue-flushed'));
      }
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
    onlineRef.current = ok;
    setOnline(ok);
    if (ok) void flush(); // online (or still online) → retry anything that's due
  }, [probe, flush]);

  useEffect(() => {
    void reloadItems();
    void recheck();
    const onEvt = () => void recheck();
    window.addEventListener('online', onEvt);
    window.addEventListener('offline', onEvt);
    // Re-probe (and retry due uploads) periodically, so a background retry happens without the
    // user doing anything.
    const iv = setInterval(() => void recheck(), 20000);
    return () => {
      window.removeEventListener('online', onEvt);
      window.removeEventListener('offline', onEvt);
      clearInterval(iv);
    };
  }, [recheck, reloadItems]);

  const enqueueFiles = useCallback(
    async (files: FileList | File[], folderId: string, folderName: string) => {
      for (const file of Array.from(files)) {
        await enqueue({
          blob: file,
          name: file.name,
          type: file.type,
          size: file.size,
          folderId,
          folderName,
          createdAt: Date.now(),
          status: 'pending',
          attempts: 0,
          nextRetryAt: 0,
        });
      }
      await reloadItems();
      if (onlineRef.current) void flush();
    },
    [reloadItems, flush],
  );

  const enqueueForRetry = useCallback(
    async (file: File, folderId: string, folderName: string, opts?: { blocked?: boolean; error?: string }) => {
      await enqueue({
        blob: file,
        name: file.name,
        type: file.type,
        size: file.size,
        folderId,
        folderName,
        createdAt: Date.now(),
        status: opts?.blocked ? 'blocked' : 'pending',
        attempts: 1,
        nextRetryAt: opts?.blocked ? 0 : Date.now() + backoffMs(1),
        lastError: opts?.error,
      });
      await reloadItems();
      if (!opts?.blocked && onlineRef.current) void flush();
    },
    [reloadItems, flush],
  );

  const retryItem = useCallback(
    async (id: number) => {
      const all = await allQueued();
      const it = all.find((x) => x.id === id);
      if (it) await updateQueued({ ...it, status: 'pending', nextRetryAt: 0 });
      await reloadItems();
      void flush();
    },
    [reloadItems, flush],
  );

  const retryAll = useCallback(async () => {
    const all = await allQueued();
    for (const it of all) {
      if (it.status === 'blocked') await updateQueued({ ...it, status: 'pending', nextRetryAt: 0 });
    }
    await reloadItems();
    void flush();
  }, [reloadItems, flush]);

  const removeItem = useCallback(
    async (id: number) => {
      await removeQueued(id);
      await reloadItems();
    },
    [reloadItems],
  );

  return (
    <Ctx.Provider value={{ online, items, enqueueFiles, enqueueForRetry, retryItem, retryAll, removeItem, flush }}>
      {children}
    </Ctx.Provider>
  );
}
