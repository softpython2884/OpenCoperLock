'use client';

import { CloudOff } from 'lucide-react';
import { useOffline } from '@/lib/offline';
import { useT } from '@/lib/i18n';

/** Thin persistent banner shown across the app whenever the device is offline. */
export function OfflineBanner() {
  const { online, items } = useOffline();
  const { t } = useT();
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-200">
      <CloudOff size={14} />
      {t('offline.banner')}
      {items.length > 0 && <span className="text-amber-300/80">· {t('offline.queued', { n: items.length })}</span>}
    </div>
  );
}
