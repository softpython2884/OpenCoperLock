'use client';

import { Languages } from 'lucide-react';
import { useT, type Lang } from '@/lib/i18n';

/** Compact FR / EN toggle. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang } = useT();
  const next: Lang = lang === 'fr' ? 'en' : 'fr';
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100 ${className}`}
    >
      <Languages size={14} />
      {lang.toUpperCase()}
    </button>
  );
}
