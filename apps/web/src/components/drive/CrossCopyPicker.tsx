'use client';

/**
 * Destination picker for copying files ACROSS the two realms — your personal Drive and the shared
 * spaces you belong to. Two steps: first pick a destination space, then navigate its folders and
 * "Copy here". It only ever lists places you're allowed to WRITE to (personal spaces are always
 * yours; shared spaces are filtered to OWNER/EDITOR), and the actual copy re-uploads through the
 * normal endpoints — so the server still enforces quota and membership on its own. ZK (zero-
 * knowledge) personal spaces are excluded because copying plaintext bytes into a blind vault would
 * need the vault key.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, ChevronRight, Home, X, FolderInput, Check, Users, FolderLock, Loader2 } from 'lucide-react';
import type { PublicFolder, PublicSpace } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export type CopyDest =
  | { realm: 'personal'; folderId: string; label: string }
  | { realm: 'shared'; spaceId: string; folderId: string | null; label: string };

interface Root {
  id: string;
  name: string;
}

export function CrossCopyPicker({
  target,
  count,
  onPick,
  onClose,
}: {
  /** Which realm we are copying INTO. */
  target: 'personal' | 'shared';
  count: number;
  onPick: (dest: CopyDest) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  // Personal folders are all fetched up front; shared folders are fetched per selected space.
  const [personalFolders, setPersonalFolders] = useState<PublicFolder[]>([]);
  const [sharedFolders, setSharedFolders] = useState<PublicFolder[]>([]);
  const [root, setRoot] = useState<Root | null>(null); // chosen destination space
  const [cwd, setCwd] = useState<string | null>(null); // folder id within the chosen space

  // Load the destination-space list.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (target === 'personal') {
          const res = await api.get<{ folders: PublicFolder[] }>('/folders');
          if (!alive) return;
          setPersonalFolders(res.folders);
          setRoots(
            res.folders
              .filter((f) => f.parentId === null && !f.isZeroKnowledge)
              .map((f) => ({ id: f.id, name: f.name }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        } else {
          const res = await api.get<{ spaces: PublicSpace[] }>('/spaces');
          if (!alive) return;
          setRoots(
            res.spaces
              .filter((s) => s.myRole === 'OWNER' || s.myRole === 'EDITOR')
              .map((s) => ({ id: s.id, name: s.name }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  // When a shared destination space is picked, fetch its folder tree.
  async function enterRoot(r: Root) {
    setRoot(r);
    setCwd(target === 'personal' ? r.id : null);
    if (target === 'shared') {
      try {
        const res = await api.get<{ folders: PublicFolder[] }>(`/spaces/${r.id}/folders`);
        setSharedFolders(res.folders);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
      }
    }
  }

  const folders = target === 'personal' ? personalFolders : sharedFolders;
  const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // For personal, the space folder itself is the root (parentId of children === root.id); for shared,
  // the root is null (folderId null). `cwd` reflects this.
  const children = useMemo(() => {
    const parent = cwd;
    return folders
      .filter((f) => f.parentId === parent && f.id !== root?.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [folders, cwd, root]);

  const trail = useMemo(() => {
    const out: PublicFolder[] = [];
    const stop = target === 'personal' ? root?.id ?? null : null;
    let cur: string | null | undefined = cwd;
    while (cur && cur !== stop) {
      const f = byId.get(cur);
      if (!f) break;
      out.unshift(f);
      cur = f.parentId;
    }
    return out;
  }, [cwd, root, byId, target]);

  if (typeof document === 'undefined') return null;

  const destName = trail.length ? trail[trail.length - 1]!.name : root?.name ?? '';
  const RealmIcon = target === 'personal' ? FolderLock : Users;

  function confirmPick() {
    if (!root) return;
    if (target === 'personal') {
      onPick({ realm: 'personal', folderId: cwd ?? root.id, label: destName });
    } else {
      onPick({ realm: 'shared', spaceId: root.id, folderId: cwd, label: destName });
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#15151d] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-semibold text-white">
              <FolderInput size={17} className="text-violet-300" />{' '}
              {target === 'personal' ? t('copy.titlePersonal') : t('copy.titleShared')}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">{t('picker.moving', { n: count })}</p>
          </div>
          <button onClick={onClose} aria-label={t('picker.close')} className="-mr-1 rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200">
            <X size={18} />
          </button>
        </div>

        {/* breadcrumb: home = back to the space list */}
        <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.05] px-5 py-2.5 text-sm text-zinc-400">
          <button
            className="flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-white/5 hover:text-zinc-100"
            onClick={() => {
              setRoot(null);
              setCwd(null);
              setSharedFolders([]);
            }}
          >
            <Home size={14} /> {t('copy.spaces')}
          </button>
          {root && (
            <span className="flex items-center gap-1">
              <ChevronRight size={13} className="text-zinc-600" />
              <button className="flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd(target === 'personal' ? root.id : null)}>
                <RealmIcon size={13} /> {root.name}
              </button>
            </span>
          )}
          {trail.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight size={13} className="text-zinc-600" />
              <button className="rounded px-1.5 py-0.5 transition hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd(f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </div>

        <div className="min-h-[9rem] flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-500">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : error ? (
            <p className="px-3 py-8 text-center text-sm text-rose-300">{error}</p>
          ) : !root ? (
            // Step 1 — choose a destination space.
            roots.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-zinc-500">{t('copy.noTargets')}</p>
            ) : (
              roots.map((r) => (
                <button
                  key={r.id}
                  onClick={() => void enterRoot(r)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.05]"
                >
                  <RealmIcon size={16} className="shrink-0 text-violet-300" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <ChevronRight size={15} className="shrink-0 text-zinc-500" />
                </button>
              ))
            )
          ) : children.length === 0 ? (
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

        {root && (
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-5 py-3.5">
            <span className="min-w-0 truncate text-xs text-zinc-500">{t('picker.dest', { name: destName })}</span>
            <button className="btn-primary shrink-0" onClick={confirmPick}>
              <Check size={15} /> {t('copy.copyHere')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
