'use client';

/**
 * Version history for a normal (server-encrypted) file, with a raw line-by-line diff between any
 * past version and the current content. Diff is computed in the browser via an LCS walk; it is
 * only offered for textual files and is skipped above a line cap to keep the table cheap.
 */
import { useEffect, useState } from 'react';
import { History, RotateCcw, GitCompare, Loader2, X } from 'lucide-react';
import { formatBytes } from '@opencoperlock/shared/client';
import { api } from '@/lib/api';
import { previewKind } from '@/lib/fileType';
import { useT } from '@/lib/i18n';
import { confirm, toast } from '@/components/ui/overlays';

interface Version {
  id: string;
  sizeBytes: number;
  createdAt: string;
}
interface DiffLine {
  type: 'eq' | 'add' | 'del';
  text: string;
}

const MAX_DIFF_LINES = 1200;

// Classic LCS backtrack → a flat add/del/eq line list. O(n·m); the caller caps n and m.
function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'eq', text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! });
      i += 1;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j += 1;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++]! });
  while (j < m) out.push({ type: 'add', text: b[j++]! });
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('fetch failed');
  return (await res.blob()).slice(0, 1_000_000).text();
}

export function VersionHistory({
  file,
  onClose,
  onRestored,
}: {
  file: { id: string; name: string; mimeType: string };
  onClose: () => void;
  onRestored: () => Promise<void> | void;
}) {
  const { t } = useT();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const [diffNote, setDiffNote] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const isText = previewKind(file.name, file.mimeType) === 'text';

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ versions: Version[] }>(`/files/${file.id}/versions`);
        res.versions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        setVersions(res.versions);
      } catch {
        setError(t('drive.versionsFailed'));
      }
    })();
  }, [file.id, t]);

  // Esc closes — the page's global shortcuts are suspended while this modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggleDiff(v: Version) {
    if (openId === v.id) {
      setOpenId(null);
      setDiff(null);
      setDiffNote(null);
      return;
    }
    setOpenId(v.id);
    setDiff(null);
    setDiffNote(null);
    if (!isText) {
      setDiffNote(t('drive.versionNotText'));
      return;
    }
    setLoadingDiff(true);
    try {
      const [curText, oldText] = await Promise.all([
        fetchText(api.url(`/files/${file.id}/download`)),
        fetchText(api.url(`/files/${file.id}/versions/${v.id}/download`)),
      ]);
      const a = oldText.split('\n');
      const b = curText.split('\n');
      if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
        setDiffNote(t('drive.versionTooLarge'));
        return;
      }
      const d = diffLines(a, b);
      if (!d.some((x) => x.type !== 'eq')) setDiffNote(t('drive.versionNoChanges'));
      else setDiff(d);
    } catch {
      setDiffNote(t('drive.versionLoadFailed'));
    } finally {
      setLoadingDiff(false);
    }
  }

  async function restore(v: Version) {
    if (!(await confirm({ title: t('drive.versionRestore'), message: t('drive.versionRestoreConfirm') }))) return;
    setRestoring(v.id);
    try {
      await api.post(`/files/${file.id}/versions/${v.id}/restore`);
      await onRestored();
      toast(t('drive.versionRestored'), 'success');
      onClose();
    } catch {
      setError(t('drive.versionsFailed'));
    } finally {
      setRestoring(null);
    }
  }

  const added = diff ? diff.filter((d) => d.type === 'add').length : 0;
  const removed = diff ? diff.filter((d) => d.type === 'del').length : 0;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-ink-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#111118] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2">
            <History size={18} className="shrink-0 text-violet-300" />
            <h3 className="truncate font-semibold text-zinc-100">{t('drive.versionHistoryTitle', { name: file.name })}</h3>
          </div>
          <button className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {error && <p className="px-2 py-3 text-sm text-red-300">{error}</p>}
          {!error && versions === null && (
            <div className="grid place-items-center py-10">
              <Loader2 className="animate-spin text-zinc-500" size={24} />
            </div>
          )}
          {versions && versions.length === 0 && <p className="px-2 py-8 text-center text-sm text-zinc-500">{t('drive.noVersions')}</p>}

          {versions && versions.length > 0 && (
            <ul className="space-y-1.5">
              {versions.map((v, idx) => (
                <li key={v.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-xs font-medium text-zinc-400">
                      v{versions.length - idx}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-200">{new Date(v.createdAt).toLocaleString()}</p>
                      <p className="text-xs text-zinc-500">{formatBytes(v.sizeBytes)}</p>
                    </div>
                    <button
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10"
                      onClick={() => void toggleDiff(v)}
                    >
                      <GitCompare size={14} /> {openId === v.id ? t('drive.versionHideDiff') : t('drive.versionDiff')}
                    </button>
                    <button
                      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-zinc-300 transition hover:bg-white/10 disabled:opacity-50"
                      disabled={restoring === v.id}
                      onClick={() => void restore(v)}
                    >
                      {restoring === v.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} {t('drive.versionRestore')}
                    </button>
                  </div>

                  {openId === v.id && (
                    <div className="border-t border-white/[0.06] px-3 py-2">
                      {loadingDiff ? (
                        <div className="flex items-center gap-2 py-3 text-sm text-zinc-500">
                          <Loader2 size={14} className="animate-spin" /> …
                        </div>
                      ) : diffNote ? (
                        <p className="py-2 text-sm text-zinc-500">{diffNote}</p>
                      ) : diff ? (
                        <>
                          <div className="mb-1.5 flex items-center gap-3 text-xs font-medium">
                            <span className="text-emerald-400">+{added}</span>
                            <span className="text-red-400">−{removed}</span>
                            <span className="text-zinc-600">{t('drive.versionDiff')}</span>
                          </div>
                          <div className="max-h-[40vh] overflow-auto rounded-lg border border-white/[0.06] bg-ink-950/60 font-mono text-xs leading-relaxed">
                            {diff.map((d, i) => (
                              <div
                                key={i}
                                className={`flex gap-2 whitespace-pre-wrap break-all px-2 ${
                                  d.type === 'add'
                                    ? 'bg-emerald-500/10 text-emerald-200'
                                    : d.type === 'del'
                                      ? 'bg-red-500/10 text-red-200'
                                      : 'text-zinc-500'
                                }`}
                              >
                                <span className="select-none text-zinc-600">{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>
                                <span>{d.text || ' '}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
