'use client';

import { useCallback, useEffect, useState } from 'react';
import { Share2, Copy, Check, ExternalLink, Trash2 } from 'lucide-react';
import type { PublicShare } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { confirm, toast } from '@/components/ui/overlays';

export default function SharesPage() {
  const { t } = useT();
  const [shares, setShares] = useState<PublicShare[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.get<{ shares: PublicShare[] }>('/shares');
    setShares(res.shares);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [load]);

  async function revoke(id: string) {
    if (!(await confirm({ title: t('shares.revokeTitle'), message: t('shares.revokeMsg'), danger: true, confirmLabel: t('shares.revoke') }))) return;
    try {
      await api.del(`/shares/${id}`);
      await load();
      toast(t('shares.revoked'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('shares.revokeFailed'));
    }
  }

  function linkFor(token: string) {
    return `${window.location.origin}/s/${token}`;
  }

  async function copy(token: string) {
    await navigator.clipboard?.writeText(linkFor(token)).catch(() => {});
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t('shares.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500">{t('shares.subtitle')}</p>
      </div>
      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</div>}

      {shares.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.04] text-zinc-500">
            <Share2 size={26} />
          </span>
          <div>
            <p className="font-medium text-zinc-200">{t('shares.empty')}</p>
            <p className="mt-1 text-sm text-zinc-500">{t('shares.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {shares.map((s) => (
            <div key={s.id} className="row flex-wrap">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-violet-300">
                  <Share2 size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">{s.targetName}</p>
                  <p className="text-xs text-zinc-500">
                    {s.access.toLowerCase()} · {s.viewType.toLowerCase()} ·{' '}
                    {s.maxDownloads
                      ? t('shares.downloadsLimited', { count: s.downloadCount, max: s.maxDownloads })
                      : t('shares.downloads', { count: s.downloadCount })}
                    {s.expiresAt && ` · ${t('shares.expiresOn', { date: new Date(s.expiresAt).toLocaleDateString() })}`}
                    {!s.allowDownload && ` · ${t('shares.readOnly')}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100" title={t('shares.copyLink')} onClick={() => copy(s.token)}>
                  {copied === s.token ? <Check size={16} /> : <Copy size={16} />}
                </button>
                <a className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100" title={t('shares.open')} href={linkFor(s.token)} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} />
                </a>
                <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-red-300" title={t('shares.revoke')} onClick={() => revoke(s.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
