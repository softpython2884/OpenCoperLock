'use client';

/**
 * Corbeille — items soft-deleted from the Drive. Each can be restored to its original place
 * or purged permanently; "Vider la corbeille" purges everything. Items left here are removed
 * automatically after the instance's retention window.
 */
import { useCallback, useEffect, useState } from 'react';
import { Trash2, RotateCcw, Folder } from 'lucide-react';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { fileVisual } from '@/lib/fileType';
import { confirm, toast } from '@/components/ui/overlays';

interface TrashEntry {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  sizeBytes: number | null;
  deletedAt: string;
}

export default function TrashPage() {
  const { refresh } = useAuth();
  const { t } = useT();
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api.get<{ entries: TrashEntry[] }>('/trash');
    setEntries(res.entries);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch((e) => {
      setError(String(e));
      setLoading(false);
    });
  }, [load]);

  async function restore(e: TrashEntry) {
    try {
      await api.post(`/trash/${e.kind}s/${e.id}/restore`);
      await Promise.all([load(), refresh()]);
      toast(t('trash.restored'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('trash.restoreFailed'));
    }
  }

  async function purge(e: TrashEntry) {
    const ok = await confirm({
      title: t('trash.purgeTitle'),
      message: t('trash.purgeMsg', { name: e.name }),
      danger: true,
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    try {
      await api.del(`/trash/${e.kind}s/${e.id}`);
      await Promise.all([load(), refresh()]);
      toast(t('trash.purged'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('trash.purgeFailed'));
    }
  }

  async function empty() {
    const ok = await confirm({
      title: t('trash.emptyConfirmTitle'),
      message: t('trash.emptyConfirmMsg'),
      danger: true,
      confirmLabel: t('trash.emptyConfirmBtn'),
    });
    if (!ok) return;
    try {
      await api.post('/trash/empty');
      await Promise.all([load(), refresh()]);
      toast(t('trash.emptied'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.opFailed'));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t('trash.title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t('trash.subtitle')}</p>
        </div>
        {entries.length > 0 && (
          <button className="btn-danger" onClick={empty}>
            <Trash2 size={16} /> {t('trash.empty')}
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</div>}

      {loading ? (
        <p className="text-sm text-zinc-500">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.04] text-zinc-500">
            <Trash2 size={26} />
          </span>
          <div>
            <p className="font-medium text-zinc-200">{t('trash.emptyTitle')}</p>
            <p className="mt-1 text-sm text-zinc-500">{t('trash.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const v = e.kind === 'file' ? fileVisual(e.name) : null;
            return (
              <div key={`${e.kind}-${e.id}`} className="row">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                      v ? `${v.bg} ${v.color}` : 'bg-white/[0.06] text-zinc-300'
                    }`}
                  >
                    {v ? <v.Icon size={16} /> : <Folder size={16} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-100">{e.name}</p>
                    <p className="text-xs text-zinc-500">
                      {e.kind === 'folder'
                        ? t('trash.folder')
                        : e.sizeBytes != null
                          ? formatBytes(e.sizeBytes)
                          : t('trash.file')}{' '}
                      · {t('trash.deletedOn', { date: new Date(e.deletedAt).toLocaleDateString() })}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                    title={t('common.restore')}
                    onClick={() => restore(e)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-red-300"
                    title={t('trash.purgeForever')}
                    onClick={() => purge(e)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
