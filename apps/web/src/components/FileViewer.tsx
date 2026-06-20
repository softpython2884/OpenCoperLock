'use client';

/**
 * Full-screen, in-app preview for a single file. Fetches the bytes once (credentialed, so it
 * works for private files), builds an object URL and renders by category: images, PDF, audio,
 * video and text are shown inline; anything else (Office docs, archives, …) falls back to a
 * download button. Works for both server-side files (fetched by URL) and Zero-Knowledge files
 * (whose decrypted Blob is passed in directly).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2, X } from 'lucide-react';
import { fileVisual, previewKind } from '@/lib/fileType';
import { formatBytes } from '@opencoperlock/shared/client';

export interface ViewerSource {
  name: string;
  mime?: string;
  sizeBytes: number;
  /** Server file: a credentialed URL to fetch. */
  url?: string;
  /** Already-decrypted bytes (Zero-Knowledge files). */
  blob?: Blob;
  /** Optional explicit download handler (e.g. ZK decrypt-and-save). */
  onDownload?: () => void;
}

export function FileViewer({ source, onClose }: { source: ViewerSource; onClose: () => void }) {
  const kind = previewKind(source.name, source.mime);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(kind !== 'none');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (kind === 'none') return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const blob = source.blob ?? (await fetchBlob(source.url!));
        if (cancelled) return;
        if (kind === 'text') {
          // Cap inline text rendering to keep the DOM light.
          setText(await blob.slice(0, 2_000_000).text());
        } else {
          url = URL.createObjectURL(blob);
          setObjectUrl(url);
        }
      } catch {
        if (!cancelled) setError("Aperçu indisponible. Vous pouvez télécharger le fichier.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.url, source.blob, kind]);

  const visual = fileVisual(source.name, source.mime);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/80 backdrop-blur-sm" onMouseDown={onClose}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${visual.bg} ${visual.color}`}>
            <visual.Icon size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">{source.name}</p>
            <p className="text-xs text-zinc-500">
              {visual.label} · {formatBytes(source.sizeBytes)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DownloadButton source={source} />
          <button
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
            onClick={onClose}
            title="Fermer"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className="flex flex-1 items-center justify-center overflow-auto p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {loading ? (
          <Loader2 className="animate-spin text-zinc-500" size={28} />
        ) : error ? (
          <Fallback visual={visual} message={error} source={source} />
        ) : kind === 'image' && objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={objectUrl} alt={source.name} className="max-h-full max-w-full rounded-lg object-contain" />
        ) : kind === 'pdf' && objectUrl ? (
          <iframe src={objectUrl} title={source.name} className="h-full w-full max-w-5xl rounded-lg bg-white" />
        ) : kind === 'video' && objectUrl ? (
          <video src={objectUrl} controls autoPlay className="max-h-full max-w-full rounded-lg" />
        ) : kind === 'audio' && objectUrl ? (
          <audio src={objectUrl} controls autoPlay className="w-full max-w-lg" />
        ) : kind === 'text' && text !== null ? (
          <pre className="h-full w-full max-w-4xl overflow-auto rounded-lg border border-white/10 bg-ink-900 p-4 text-xs leading-relaxed text-zinc-300">
            {text}
          </pre>
        ) : (
          <Fallback
            visual={visual}
            message="Aucun aperçu pour ce type de fichier. Téléchargez-le pour l’ouvrir."
            source={source}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

function Fallback({
  visual,
  message,
  source,
}: {
  visual: ReturnType<typeof fileVisual>;
  message: string;
  source: ViewerSource;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className={`grid h-16 w-16 place-items-center rounded-2xl ${visual.bg} ${visual.color}`}>
        <visual.Icon size={30} />
      </span>
      <p className="max-w-sm text-sm text-zinc-400">{message}</p>
      <DownloadButton source={source} primary />
    </div>
  );
}

function DownloadButton({ source, primary }: { source: ViewerSource; primary?: boolean }) {
  const cls = primary ? 'btn-primary' : 'btn-ghost';
  if (source.onDownload) {
    return (
      <button className={cls} onClick={source.onDownload}>
        <Download size={16} /> Télécharger
      </button>
    );
  }
  return (
    <a className={cls} href={source.url} download={source.name}>
      <Download size={16} /> Télécharger
    </a>
  );
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}
