'use client';

/**
 * Destination picker for "Move". A small folder browser: navigate the space's tree, then "Move
 * here". Destinations stay INSIDE the space (root = the space folder itself), so a move can never
 * strand a file outside every space. The moved folder and its subtree are excluded to prevent
 * cycles.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, ChevronRight, Home, X, FolderInput, Check } from 'lucide-react';
import type { PublicFolder } from '@opencoperlock/shared/client';
import { useT } from '@/lib/i18n';

export function FolderPicker({
  folders,
  rootId,
  rootName,
  excludeIds,
  currentId,
  count,
  onPick,
  onClose,
}: {
  folders: PublicFolder[];
  rootId: string;
  rootName: string;
  excludeIds: Set<string>;
  currentId: string | null;
  count: number;
  onPick: (folderId: string) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [cwd, setCwd] = useState<string>(rootId);
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const children = useMemo(
    () =>
      folders
        .filter((f) => f.parentId === cwd && !excludeIds.has(f.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, cwd, excludeIds],
  );
  const trail = useMemo(() => {
    const out: PublicFolder[] = [];
    let cur: string | null = cwd;
    while (cur && cur !== rootId) {
      const f = byId.get(cur);
      if (!f) break;
      out.unshift(f);
      cur = f.parentId;
    }
    return out;
  }, [cwd, rootId, byId]);

  if (typeof document === 'undefined') return null;
  const alreadyHere = cwd === currentId;
  const destName = trail.length ? trail[trail.length - 1]!.name : rootName;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#15151d] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-white">
              <FolderInput size={17} className="text-violet-300" /> {t('picker.title')}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">{t('picker.moving', { n: count })}</p>
          </div>
          <button onClick={onClose} aria-label={t('picker.close')} className="-mr-1 rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200">
            <X size={18} />
          </button>
        </div>

        {/* breadcrumb */}
        <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.05] px-5 py-2.5 text-sm text-zinc-400">
          <button className="flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd(rootId)}>
            <Home size={14} /> {rootName}
          </button>
          {trail.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight size={13} className="text-zinc-600" />
              <button className="rounded px-1.5 py-0.5 transition hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd(f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </div>

        {/* folder list */}
        <div className="min-h-[9rem] flex-1 overflow-y-auto p-2">
          {children.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">{t('picker.noSubfolders')}</p>
          ) : (
            children.map((f) => (
              <button
                key={f.id}
                onClick={() => setCwd(f.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.05]"
              >
                <Folder size={16} className="shrink-0 text-amber-200" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <ChevronRight size={15} className="shrink-0 text-zinc-500" />
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-3.5">
          <span className="min-w-0 truncate text-xs text-zinc-500">
            {alreadyHere ? t('picker.alreadyHere') : t('picker.dest', { name: destName })}
          </span>
          <button className="btn-primary shrink-0" disabled={alreadyHere} onClick={() => onPick(cwd)}>
            <Check size={15} /> {t('picker.moveHere')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
