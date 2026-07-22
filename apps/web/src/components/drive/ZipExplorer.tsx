'use client';

/**
 * Read-only browser for the contents of a .zip, WITHOUT extracting it into the Drive. The archive is
 * decompressed in memory (by the caller, via fflate) and handed in as a path→bytes map; here we just
 * present it as a navigable tree with per-entry size, and let the user preview or download a single
 * entry. Nothing touches the server — it's all client-side on bytes we already hold.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, File as FileIcon, ChevronRight, Home, X, Download, Eye, Archive } from 'lucide-react';
import { formatBytes } from '@opencoperlock/shared/client';
import { previewKind } from '@/lib/fileType';
import { useT } from '@/lib/i18n';

type Row =
  | { type: 'dir'; name: string; path: string; count: number }
  | { type: 'file'; name: string; path: string; size: number };

const asPart = (u: Uint8Array): BlobPart => u as unknown as BlobPart;

export function ZipExplorer({
  name,
  entries,
  onClose,
}: {
  name: string;
  entries: Record<string, Uint8Array>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [cwd, setCwd] = useState('');
  const [preview, setPreview] = useState<{ path: string; url?: string; text?: string } | null>(null);

  // Real files only (skip the zero-length directory markers some zips carry).
  const files = useMemo(
    () => Object.entries(entries).filter(([p, d]) => !p.endsWith('/') && d.length > 0),
    [entries],
  );
  const totalSize = useMemo(() => files.reduce((n, [, d]) => n + d.length, 0), [files]);

  // Direct children of the current directory: immediate files + sub-folders (deduped).
  const rows = useMemo<Row[]>(() => {
    const prefix = cwd ? cwd + '/' : '';
    const dirs = new Map<string, number>();
    const out: Row[] = [];
    for (const [path, data] of files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        out.push({ type: 'file', name: rest, path, size: data.length });
      } else {
        const dir = rest.slice(0, slash);
        dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
      }
    }
    const dirRows: Row[] = [...dirs.entries()].map(([dir, count]) => ({
      type: 'dir',
      name: dir,
      path: prefix + dir,
      count,
    }));
    return [...dirRows.sort((a, b) => a.name.localeCompare(b.name)), ...out.sort((a, b) => a.name.localeCompare(b.name))];
  }, [files, cwd]);

  const trail = useMemo(() => (cwd ? cwd.split('/') : []), [cwd]);

  // Build/tear-down an object URL for image previews so we don't leak blobs.
  useEffect(() => {
    if (!preview?.url) return;
    const url = preview.url;
    return () => URL.revokeObjectURL(url);
  }, [preview?.url]);

  function download(path: string) {
    const data = entries[path];
    if (!data) return;
    const url = URL.createObjectURL(new Blob([asPart(data)]));
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() ?? 'file';
    a.click();
    URL.revokeObjectURL(url);
  }

  function openPreview(path: string) {
    const data = entries[path];
    if (!data) return;
    const kind = previewKind(path);
    if (kind === 'image') {
      setPreview({ path, url: URL.createObjectURL(new Blob([asPart(data)])) });
    } else if (kind === 'text') {
      const text = new TextDecoder().decode(data.slice(0, 200_000));
      setPreview({ path, text });
    } else {
      download(path);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#15151d] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 truncate font-semibold text-white">
              <Archive size={17} className="shrink-0 text-amber-300" /> <span className="truncate">{name}</span>
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {t('zip.summary', { files: files.length, size: formatBytes(totalSize) })}
            </p>
          </div>
          <button onClick={onClose} aria-label={t('picker.close')} className="-mr-1 rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200">
            <X size={18} />
          </button>
        </div>

        {/* breadcrumb */}
        <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.05] px-5 py-2.5 text-sm text-zinc-400">
          <button className="flex items-center gap-1 rounded px-1.5 py-0.5 transition hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd('')}>
            <Home size={14} /> {t('zip.root')}
          </button>
          {trail.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight size={13} className="text-zinc-600" />
              <button className="rounded px-1.5 py-0.5 transition hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd(trail.slice(0, i + 1).join('/'))}>
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* entry list */}
        <div className="min-h-[10rem] flex-1 overflow-y-auto p-2">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-500">{t('zip.empty')}</p>
          ) : (
            rows.map((r) =>
              r.type === 'dir' ? (
                <button
                  key={r.path}
                  onClick={() => setCwd(r.path)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.05]"
                >
                  <Folder size={16} className="shrink-0 text-amber-200" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{t('zip.items', { n: r.count })}</span>
                  <ChevronRight size={15} className="shrink-0 text-zinc-500" />
                </button>
              ) : (
                <div
                  key={r.path}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.05]"
                >
                  <FileIcon size={16} className="shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{formatBytes(r.size)}</span>
                  {previewKind(r.name) !== 'none' && (
                    <button title={t('zip.preview')} onClick={() => openPreview(r.path)} className="shrink-0 rounded p-1 text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-zinc-200 group-hover:opacity-100">
                      <Eye size={15} />
                    </button>
                  )}
                  <button title={t('zip.download')} onClick={() => download(r.path)} className="shrink-0 rounded p-1 text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-zinc-200 group-hover:opacity-100">
                    <Download size={15} />
                  </button>
                </div>
              ),
            )
          )}
        </div>
      </div>

      {/* single-entry preview */}
      {preview && (
        <div className="absolute inset-0 z-[10] flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#15151d] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
              <p className="min-w-0 truncate text-sm font-medium text-zinc-200">{preview.path.split('/').pop()}</p>
              <button onClick={() => setPreview(null)} className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200">
                <X size={17} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              {preview.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.url} alt={preview.path} className="mx-auto max-h-[65vh] max-w-full rounded-lg" />
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-300">{preview.text}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
