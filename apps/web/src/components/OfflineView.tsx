'use client';

/**
 * Minimal offline screen shown on the Drive when there's no network. You can still pick files —
 * they're stored locally (IndexedDB) and uploaded automatically when the connection returns.
 */
import { useMemo, useRef, useState } from 'react';
import { CloudOff, UploadCloud, X, Loader2 } from 'lucide-react';
import type { PublicFolder } from '@opencoperlock/shared/client';
import { FAST_UPLOAD_FOLDER_NAME, formatBytes } from '@opencoperlock/shared/client';
import { useT } from '@/lib/i18n';
import { useOffline } from '@/lib/offline';
import { Select } from '@/components/ui/Select';

function cachedFolders(): PublicFolder[] {
  try {
    const raw = localStorage.getItem('ocl_folders');
    return raw ? (JSON.parse(raw) as PublicFolder[]) : [];
  } catch {
    return [];
  }
}

export function OfflineView() {
  const { t } = useT();
  const { items, enqueueFiles, removeItem } = useOffline();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const folders = useMemo(() => cachedFolders().filter((f) => !f.isZeroKnowledge), []);
  const options = [
    { value: '', label: FAST_UPLOAD_FOLDER_NAME },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];
  const defaultId = folders.find((f) => f.name === FAST_UPLOAD_FOLDER_NAME)?.id ?? '';
  const [folderId, setFolderId] = useState(defaultId);

  async function add(list: FileList | File[] | null) {
    if (!list) return;
    const name = options.find((o) => o.value === folderId)?.label ?? FAST_UPLOAD_FOLDER_NAME;
    await enqueueFiles(list, folderId, name);
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 py-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-500/10 text-amber-300">
          <CloudOff size={22} />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-white">{t('offline.title')}</h1>
          <p className="text-sm text-zinc-500">{t('offline.subtitle')}</p>
        </div>
      </div>

      <div className="card space-y-3">
        <label className="block text-sm text-zinc-400">{t('offline.destination')}</label>
        <Select className="w-full" value={folderId} onChange={setFolderId} options={options} />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void add(e.dataTransfer.files);
          }}
          onClick={() => fileInput.current?.click()}
          className={`grid cursor-pointer place-items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? 'border-accent/70 bg-accent/[0.06]' : 'border-white/15 hover:border-white/25'
          }`}
        >
          <UploadCloud size={28} className="text-zinc-400" />
          <p className="text-sm font-medium text-zinc-200">{t('offline.pick')}</p>
          <p className="text-xs text-zinc-500">{t('offline.pickHint')}</p>
        </div>
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => void add(e.target.files)} />
      </div>

      {items.length > 0 && (
        <div className="card space-y-2">
          <p className="text-sm font-medium text-zinc-200">{t('offline.queued', { n: items.length })}</p>
          <div className="divide-y divide-white/[0.06]">
            {items.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <Loader2 size={14} className="shrink-0 animate-spin text-amber-300" />
                  <span className="truncate text-zinc-200">{it.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{formatBytes(it.blob.size)} · {it.folderName}</span>
                </div>
                <button
                  className="rounded-lg p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                  onClick={() => it.id != null && void removeItem(it.id)}
                  title={t('offline.remove')}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">{t('offline.willSync')}</p>
        </div>
      )}
    </div>
  );
}
