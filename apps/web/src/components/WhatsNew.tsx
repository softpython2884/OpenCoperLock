'use client';

/**
 * "What's new" dialog, shown once per update to every signed-in user. The API serves the changes
 * since the build the user last acknowledged, parsed from the commit messages; dismissing it
 * records the current build so it never reappears for that version.
 *
 * Design: deliberately sober "release notes" — no icons, no decoration. Each line is just the
 * commit's SUBJECT (its `type(scope):` prefix stripped, capitalised). The long, technical commit
 * BODY is intentionally NOT shown: it is internal detail, not end-user copy.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

interface ChangelogEntry {
  type: string | null;
  title: string;
  body: string;
}
interface WhatsNew {
  show: boolean;
  version?: string;
  entries?: ChangelogEntry[];
  count?: number;
  githubUrl?: string | null;
}

export function WhatsNew() {
  const { user } = useAuth();
  const { t } = useT();
  const [data, setData] = useState<WhatsNew | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void api
      .get<WhatsNew>('/version/whats-new')
      .then((res) => {
        if (!cancelled && res.show) setData(res);
      })
      .catch(() => {
        /* best-effort: a failed check just means no popup this time */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function dismiss() {
    setData(null);
    await api.post('/version/whats-new/seen').catch(() => {});
  }

  if (!data?.show || typeof document === 'undefined') return null;
  const entries = data.entries ?? [];
  const extra = (data.count ?? entries.length) - entries.length;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#15151d] shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-300/90">{t('whatsnew.label')}</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-white">{t('whatsnew.title')}</h2>
            {data.version && (
              <p className="mt-1 font-mono text-xs text-zinc-500">
                {t('whatsnew.version', { version: data.version })}
                {typeof data.count === 'number' && data.count > 0 && ` · ${t('whatsnew.changes', { count: data.count })}`}
              </p>
            )}
          </div>
          <button
            onClick={dismiss}
            aria-label={t('whatsnew.dismiss')}
            className="-mr-1 rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mx-6 mt-4 border-t border-white/[0.07]" />

        <ul className="overflow-y-auto px-6 py-2">
          {entries.map((e, i) => (
            <li key={i} className="border-t border-white/[0.05] py-2.5 first:border-t-0">
              <p className="text-[13.5px] leading-snug text-zinc-200">{e.title}</p>
            </li>
          ))}
          {extra > 0 && <li className="border-t border-white/[0.05] py-2.5 text-xs italic text-zinc-500">{t('whatsnew.more', { count: extra })}</li>}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-6 py-3.5">
          {data.githubUrl ? (
            <a
              href={data.githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-violet-300 transition hover:text-violet-200"
            >
              {t('whatsnew.viewOnGithub')} <ExternalLink size={13} />
            </a>
          ) : (
            <span />
          )}
          <button className="btn-primary" onClick={dismiss}>
            {t('whatsnew.gotIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
