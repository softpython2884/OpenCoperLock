'use client';

/**
 * "What's new" dialog, shown once per update to every signed-in user. The API serves the changes
 * since the build the user last acknowledged, parsed from the commit messages into structured
 * entries; dismissing it records the current build so it never reappears for that version.
 *
 * Design: sober "release notes" — no decorative icon. Each entry shows an icon derived from the
 * commit's conventional-commit type (feat/fix/…), a clean title, and its long-form body tucked
 * behind a "Details" toggle (commit bodies are verbose, so they stay collapsed by default).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Wrench, Zap, BookOpen, ChevronDown, X, type LucideIcon } from 'lucide-react';
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
}

// Map a conventional-commit type to a small, meaningful icon + tint. Anything unrecognised gets a
// neutral dot, so the list stays calm rather than noisy.
const TYPE_STYLE: Record<string, { icon: LucideIcon; cls: string }> = {
  feat: { icon: Check, cls: 'bg-violet-500/15 text-violet-300' },
  fix: { icon: Wrench, cls: 'bg-amber-500/15 text-amber-300' },
  perf: { icon: Zap, cls: 'bg-sky-500/15 text-sky-300' },
  docs: { icon: BookOpen, cls: 'bg-white/[0.06] text-zinc-300' },
};

function EntryRow({ e }: { e: ChangelogEntry }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const style = e.type ? TYPE_STYLE[e.type] : undefined;
  const Icon = style?.icon;

  return (
    <li className="flex gap-3">
      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${style?.cls ?? 'text-zinc-600'}`}>
        {Icon ? <Icon size={14} /> : <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13.5px] leading-snug text-zinc-100">{e.title}</p>
          {e.body && (
            <button
              onClick={() => setOpen((o) => !o)}
              className="mt-0.5 flex shrink-0 items-center gap-0.5 text-[11px] text-zinc-500 transition hover:text-zinc-300"
            >
              {t('whatsnew.details')}
              <ChevronDown size={12} className={`transition ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
        {open && e.body && (
          <div className="md-prose mt-2 border-l border-white/10 pl-3 text-xs text-zinc-400">
            <Markdown remarkPlugins={[remarkGfm]}>{e.body}</Markdown>
          </div>
        )}
      </div>
    </li>
  );
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

        <ul className="space-y-3.5 overflow-y-auto px-6 py-4">
          {entries.map((e, i) => (
            <EntryRow key={i} e={e} />
          ))}
          {extra > 0 && <li className="pl-9 text-xs italic text-zinc-500">{t('whatsnew.more', { count: extra })}</li>}
        </ul>

        <div className="border-t border-white/[0.07] px-6 py-3.5 text-right">
          <button className="btn-primary" onClick={dismiss}>
            {t('whatsnew.gotIt')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
