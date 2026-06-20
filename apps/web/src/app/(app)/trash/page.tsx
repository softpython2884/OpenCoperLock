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
      toast('Restauré', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Restauration impossible');
    }
  }

  async function purge(e: TrashEntry) {
    const ok = await confirm({
      title: 'Supprimer définitivement ?',
      message: `« ${e.name} » sera détruit et ne pourra plus être récupéré.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (!ok) return;
    try {
      await api.del(`/trash/${e.kind}s/${e.id}`);
      await Promise.all([load(), refresh()]);
      toast('Supprimé définitivement', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible');
    }
  }

  async function empty() {
    const ok = await confirm({
      title: 'Vider la corbeille ?',
      message: 'Tous les éléments seront détruits définitivement.',
      danger: true,
      confirmLabel: 'Tout supprimer',
    });
    if (!ok) return;
    try {
      await api.post('/trash/empty');
      await Promise.all([load(), refresh()]);
      toast('Corbeille vidée', 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opération impossible');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Corbeille</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Les éléments supprimés sont conservés ici, puis effacés automatiquement après un délai.
          </p>
        </div>
        {entries.length > 0 && (
          <button className="btn-danger" onClick={empty}>
            <Trash2 size={16} /> Vider la corbeille
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</div>}

      {loading ? (
        <p className="text-sm text-zinc-500">Chargement…</p>
      ) : entries.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.04] text-zinc-500">
            <Trash2 size={26} />
          </span>
          <div>
            <p className="font-medium text-zinc-200">La corbeille est vide</p>
            <p className="mt-1 text-sm text-zinc-500">Les fichiers et dossiers supprimés apparaîtront ici.</p>
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
                      {e.kind === 'folder' ? 'Dossier' : e.sizeBytes != null ? formatBytes(e.sizeBytes) : 'Fichier'} ·
                      supprimé le {new Date(e.deletedAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
                    title="Restaurer"
                    onClick={() => restore(e)}
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button
                    className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-red-300"
                    title="Supprimer définitivement"
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
