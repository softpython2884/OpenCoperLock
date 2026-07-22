'use client';

/**
 * Floating panel listing uploads that are being retried in the background or paused for lack of
 * space. Lets the user retry a paused item (after freeing space), retry them all, or drop one.
 * Hidden when the queue is empty.
 */
import { UploadCloud, RefreshCw, PauseCircle, X } from 'lucide-react';
import { formatBytes } from '@opencoperlock/shared/client';
import { useOffline } from '@/lib/offline';
import { useT } from '@/lib/i18n';

export function TransfersPanel() {
  const { items, retryItem, retryAll, removeItem } = useOffline();
  const { t } = useT();
  if (items.length === 0) return null;
  const blocked = items.filter((i) => i.status === 'blocked').length;

  return (
    <div className="fixed bottom-4 right-4 z-[110] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-[#15151d] shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-200">
          <UploadCloud size={15} className="text-violet-300" /> {t('transfers.title', { n: items.length })}
        </span>
        {blocked > 0 && (
          <button className="text-xs text-violet-300 transition hover:text-violet-200" onClick={() => void retryAll()}>
            {t('transfers.retryAll')}
          </button>
        )}
      </div>
      <div className="max-h-64 space-y-0.5 overflow-y-auto p-1.5">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
            <span className={`shrink-0 ${it.status === 'blocked' ? 'text-amber-300' : 'text-zinc-400'}`}>
              {it.status === 'blocked' ? <PauseCircle size={15} /> : <RefreshCw size={15} className="animate-spin" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-100">{it.name}</p>
              <p className="truncate text-[11px] text-zinc-500">
                {formatBytes(it.size)} ·{' '}
                {it.status === 'blocked' ? it.lastError ?? t('transfers.paused') : t('transfers.retrying')}
              </p>
            </div>
            {it.status === 'blocked' && it.id != null && (
              <button
                className="shrink-0 rounded p-1 text-zinc-400 transition hover:text-violet-300"
                title={t('transfers.retry')}
                onClick={() => void retryItem(it.id!)}
              >
                <RefreshCw size={14} />
              </button>
            )}
            {it.id != null && (
              <button
                className="shrink-0 rounded p-1 text-zinc-400 transition hover:text-red-300"
                title={t('transfers.remove')}
                onClick={() => void removeItem(it.id!)}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
