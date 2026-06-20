'use client';

/**
 * Registers the service worker that makes OpenCoperLock an installable PWA. The worker is
 * intentionally minimal (app-shell only, never caches API responses or private files), so it
 * adds installability and an offline shell without risking stale or leaked data.
 */
import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const onLoad = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}
