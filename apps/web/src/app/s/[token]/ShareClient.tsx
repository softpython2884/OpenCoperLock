'use client';

/**
 * Public share recipient page. Works without a login (and honours a session for
 * AUTHENTICATED-mode links). Renders a preview for a single file, or a file listing for a
 * shared folder, and respects the link's access mode (public / code / sign-in required),
 * expiry, and download-disabled flag.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import type { PublicShareView, ShareEntry } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { API_URL, api, ApiError } from '@/lib/api';
import { Wordmark } from '@/components/Wordmark';
import { fileVisual } from '@/lib/fileType';

function fileUrl(token: string, fileId: string, opts: { inline?: boolean; code?: string }): string {
  const q = new URLSearchParams();
  if (opts.inline) q.set('inline', '1');
  if (opts.code) q.set('code', opts.code);
  const qs = q.toString();
  return `${API_URL}/s/${token}/file/${fileId}${qs ? `?${qs}` : ''}`;
}

export default function ShareClient({ token }: { token: string }) {
  const [view, setView] = useState<PublicShareView | null>(null);
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(
    async (withCode?: string) => {
      setError(null);
      try {
        const q = withCode ? `?code=${encodeURIComponent(withCode)}` : '';
        const res = await api.get<PublicShareView>(`/s/${token}${q}`);
        setView(res);
        if (withCode && res.requiresCode) setError('Code incorrect.');
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof ApiError ? err.message : 'Impossible de charger ce lien');
      }
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // RAW single-file links behave like a direct file: open it inline once accessible.
  useEffect(() => {
    if (view?.viewType === 'RAW' && view.file && !view.requiresCode && !view.requiresAuth && !view.expired) {
      window.location.replace(fileUrl(token, view.file.fileId, { inline: true, code: submittedCode }));
    }
  }, [view, token, submittedCode]);

  if (notFound) return <Centered title="Lien introuvable" subtitle="Ce lien de partage est invalide ou a été révoqué." />;
  if (!view) return <Centered title="Chargement…" />;
  if (view.expired) return <Centered title="Lien expiré" subtitle="Ce partage n’est plus disponible." />;

  if (view.requiresAuth) {
    return (
      <Centered title="Connexion requise" subtitle="Ce lien est réservé aux titulaires d’un compte.">
        <a className="btn-primary" href="/login">
          Se connecter
        </a>
      </Centered>
    );
  }

  if (view.requiresCode) {
    return (
      <Centered title="Lien protégé" subtitle="Entrez le code pour accéder à ce partage.">
        <form
          className="flex w-full max-w-xs flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmittedCode(code);
            void load(code);
          }}
        >
          <input
            className="input"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code d’accès"
            autoFocus
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button className="btn-primary">Déverrouiller</button>
        </form>
      </Centered>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <header className="mb-6 flex items-center justify-between">
          <Link href="/" className="transition hover:opacity-80">
            <Wordmark />
          </Link>
          <span className="text-xs text-zinc-500">Partage{view.isFolder ? ' de dossier' : ' de fichier'}</span>
        </header>

        {view.file && (
          <FileCard token={token} entry={view.file} allowDownload={view.allowDownload} code={submittedCode} />
        )}

        {view.entries && (
          <div className="space-y-3">
            <h1 className="text-lg font-semibold text-white">Dossier partagé ({view.entries.length} fichiers)</h1>
            {view.entries.length === 0 && <p className="text-sm text-zinc-500">Ce dossier est vide.</p>}
            {view.entries.map((entry) => (
              <FileCard key={entry.fileId} token={token} entry={entry} allowDownload={view.allowDownload} code={submittedCode} compact />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-white/[0.06] px-4 py-4 text-center text-xs text-zinc-500">
        Propulsé par <Wordmark className="!text-xs" /> ·{' '}
        <a href="https://forgenet.fr" target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
          Forge Network
        </a>
      </footer>
    </div>
  );
}

function FileCard({
  token,
  entry,
  allowDownload,
  code,
  compact,
}: {
  token: string;
  entry: ShareEntry;
  allowDownload: boolean;
  code?: string;
  compact?: boolean;
}) {
  const v = fileVisual(entry.name, entry.mimeType);
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${v.bg} ${v.color}`}>
            <v.Icon size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-100">{entry.name}</p>
            <p className="text-xs text-zinc-500">
              {v.label} · {formatBytes(entry.sizeBytes)}
            </p>
          </div>
        </div>
        {allowDownload && (
          <a className="btn-primary shrink-0 whitespace-nowrap" href={fileUrl(token, entry.fileId, { code })}>
            <Download size={16} /> Télécharger
          </a>
        )}
      </div>
      {!compact && <Preview token={token} entry={entry} code={code} />}
    </div>
  );
}

function Preview({ token, entry, code }: { token: string; entry: ShareEntry; code?: string }) {
  const url = fileUrl(token, entry.fileId, { inline: true, code });
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (entry.kind === 'text' && entry.sizeBytes < 1_000_000) {
      fetch(url, { credentials: 'include' })
        .then((r) => r.text())
        .then(setText)
        .catch(() => setText(null));
    }
  }, [url, entry.kind, entry.sizeBytes]);

  switch (entry.kind) {
    case 'image':
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={url} alt={entry.name} className="max-h-[60vh] w-auto rounded-lg border border-white/10" />;
    case 'pdf':
      return <iframe src={url} title={entry.name} className="h-[70vh] w-full rounded-lg border border-white/10 bg-white" />;
    case 'audio':
      return <audio src={url} controls className="w-full" />;
    case 'video':
      return <video src={url} controls className="max-h-[60vh] w-full rounded-lg" />;
    case 'text':
      return text !== null ? (
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-white/10 bg-ink-900 p-3 text-xs text-zinc-300">{text}</pre>
      ) : (
        <p className="text-sm text-zinc-500">Aperçu indisponible.</p>
      );
    default:
      return <p className="text-sm text-zinc-500">Aucun aperçu disponible pour ce type de fichier.</p>;
  }
}

function Centered({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="max-w-sm text-sm text-zinc-500">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
