'use client';

/**
 * "What's new" dialog, shown once per update to every signed-in user. After a build is deployed,
 * the API serves the release notes for everything that changed since the build the user last
 * acknowledged; dismissing it records the current build so it never reappears for that version.
 *
 * The notes are Markdown built from the commit messages, rendered with the same pipeline as the
 * in-app document viewer.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';

interface WhatsNew {
  show: boolean;
  version?: string;
  notes?: string;
  count?: number;
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

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismiss} />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#15151d] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-violet-200">
              <Sparkles size={20} />
            </span>
            <div>
              <h2 className="font-semibold text-white">{t('whatsnew.title')}</h2>
              {data.version && (
                <p className="text-xs text-zinc-500">
                  {t('whatsnew.version', { version: data.version })}
                  {typeof data.count === 'number' && data.count > 0 && ` · ${t('whatsnew.changes', { count: data.count })}`}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label={t('whatsnew.dismiss')}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="md-prose overflow-y-auto px-5 py-4 text-sm">
          <Markdown remarkPlugins={[remarkGfm]}>{data.notes ?? ''}</Markdown>
        </div>

        <div className="border-t border-white/[0.07] px-5 py-3 text-right">
          <button className="btn-primary" onClick={dismiss}>
            {t('whatsnew.gotIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
