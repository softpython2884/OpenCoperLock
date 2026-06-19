'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicShare } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';

export default function SharesPage() {
  const [shares, setShares] = useState<PublicShare[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ shares: PublicShare[] }>('/shares');
    setShares(res.shares);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [load]);

  async function revoke(id: string) {
    if (!window.confirm('Revoke this link? It will stop working immediately.')) return;
    try {
      await api.del(`/shares/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke');
    }
  }

  function linkFor(token: string) {
    return `${window.location.origin}/s/${token}`;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Share links</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {shares.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No share links yet. Use the Share button on a file or folder in the Drive.
        </p>
      ) : (
        <div className="card divide-y divide-neutral-100 p-0 dark:divide-neutral-800">
          {shares.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.targetName}</p>
                <p className="text-xs text-neutral-400">
                  {s.access.toLowerCase()} · {s.viewType.toLowerCase()} ·{' '}
                  {s.maxDownloads ? `${s.downloadCount}/${s.maxDownloads} downloads` : `${s.downloadCount} downloads`}
                  {s.expiresAt && ` · expires ${new Date(s.expiresAt).toLocaleDateString()}`}
                  {!s.allowDownload && ' · view-only'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={() => navigator.clipboard?.writeText(linkFor(s.token))}
                >
                  Copy link
                </button>
                <a className="btn-ghost px-2 py-1" href={linkFor(s.token)} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button className="btn-danger px-2 py-1" onClick={() => revoke(s.id)}>
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
