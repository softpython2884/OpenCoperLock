'use client';

/**
 * Public share recipient page. Works without a login (and honours a session for
 * AUTHENTICATED-mode links). Renders a preview for a single file, or a file listing for a
 * shared folder, and respects the link's access mode (public / code / sign-in required),
 * expiry, and download-disabled flag.
 */
import { use, useCallback, useEffect, useState } from 'react';
import type { PublicShareView, ShareEntry } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { API_URL, api, ApiError } from '@/lib/api';

function fileUrl(token: string, fileId: string, opts: { inline?: boolean; code?: string }): string {
  const q = new URLSearchParams();
  if (opts.inline) q.set('inline', '1');
  if (opts.code) q.set('code', opts.code);
  const qs = q.toString();
  return `${API_URL}/s/${token}/file/${fileId}${qs ? `?${qs}` : ''}`;
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<PublicShareView | null>(null);
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async (withCode?: string) => {
    setError(null);
    try {
      const q = withCode ? `?code=${encodeURIComponent(withCode)}` : '';
      const res = await api.get<PublicShareView>(`/s/${token}${q}`);
      setView(res);
      if (withCode && res.requiresCode) setError('Incorrect code.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof ApiError ? err.message : 'Could not load this link');
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // RAW single-file links behave like a direct file: open it inline once accessible.
  useEffect(() => {
    if (view?.viewType === 'RAW' && view.file && !view.requiresCode && !view.requiresAuth && !view.expired) {
      window.location.replace(fileUrl(token, view.file.fileId, { inline: true, code: submittedCode }));
    }
  }, [view, token, submittedCode]);

  if (notFound) return <Centered title="Link not found" subtitle="This share link is invalid or has been revoked." />;
  if (!view) return <Centered title="Loading…" />;
  if (view.expired) return <Centered title="Link expired" subtitle="This share is no longer available." />;

  if (view.requiresAuth) {
    return (
      <Centered title="Sign-in required" subtitle="This link is restricted to account holders.">
        <a className="btn-primary" href="/login">
          Sign in
        </a>
      </Centered>
    );
  }

  if (view.requiresCode) {
    return (
      <Centered title="Protected link" subtitle="Enter the code to access this share.">
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
            placeholder="Access code"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary">Unlock</button>
        </form>
      </Centered>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 flex items-center justify-between">
        <span className="font-semibold">OpenCoperLock</span>
        <span className="text-xs text-neutral-400">Shared file{view.isFolder ? 's' : ''}</span>
      </header>

      {view.file && (
        <FileCard token={token} entry={view.file} allowDownload={view.allowDownload} code={submittedCode} />
      )}

      {view.entries && (
        <div className="space-y-3">
          <h1 className="text-lg font-semibold">Shared folder ({view.entries.length} files)</h1>
          {view.entries.length === 0 && <p className="text-sm text-neutral-400">This folder is empty.</p>}
          {view.entries.map((entry) => (
            <FileCard
              key={entry.fileId}
              token={token}
              entry={entry}
              allowDownload={view.allowDownload}
              code={submittedCode}
              compact
            />
          ))}
        </div>
      )}
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
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{entry.name}</p>
          <p className="text-xs text-neutral-400">
            {formatBytes(entry.sizeBytes)} · {entry.mimeType}
          </p>
        </div>
        {allowDownload && (
          <a className="btn-primary whitespace-nowrap" href={fileUrl(token, entry.fileId, { code })}>
            Download
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
      return <img src={url} alt={entry.name} className="max-h-[60vh] w-auto rounded border border-neutral-200 dark:border-neutral-800" />;
    case 'pdf':
      return <iframe src={url} title={entry.name} className="h-[70vh] w-full rounded border border-neutral-200 dark:border-neutral-800" />;
    case 'audio':
      return <audio src={url} controls className="w-full" />;
    case 'video':
      return <video src={url} controls className="max-h-[60vh] w-full rounded" />;
    case 'text':
      return text !== null ? (
        <pre className="max-h-[60vh] overflow-auto rounded bg-neutral-50 p-3 text-xs dark:bg-neutral-900">{text}</pre>
      ) : (
        <p className="text-sm text-neutral-400">Preview unavailable.</p>
      );
    default:
      return <p className="text-sm text-neutral-400">No preview available for this file type.</p>;
  }
}

function Centered({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="max-w-sm text-sm text-neutral-500">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
