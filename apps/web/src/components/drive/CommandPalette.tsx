'use client';

/**
 * Ctrl/⌘+K command palette. The Drive page hands it a flat list of candidate items (commands,
 * folders/spaces to jump to, files in the open folder to open); the palette does fuzzy filtering,
 * keyboard navigation and dispatch. Item runners close the palette themselves via onClose.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';

export interface PaletteItem {
  id: string;
  kind: 'command' | 'folder' | 'file';
  label: string;
  sub?: string;
  icon: LucideIcon;
  run: () => void;
}

/** Subsequence fuzzy match: returns a score (higher = better) or -1 when it doesn't match. */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx === 0) return 1000 - text.length; // prefix match — best
  if (idx > 0) return 500 - idx; // substring match
  // fall back to in-order subsequence
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) if (t[i] === q[qi]) qi += 1;
  return qi === q.length ? 100 - text.length : -1;
}

export function CommandPalette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return items.slice(0, 12);
    return items
      .map((it) => ({ it, score: Math.max(fuzzyScore(query, it.label), it.sub ? fuzzyScore(query, it.sub) : -1) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((r) => r.it);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-start justify-center bg-ink-950/80 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-[#15151d] shadow-2xl ring-1 ring-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3.5">
          <Search size={16} className="shrink-0 text-zinc-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('drive.searchPlaceholder')}
            className="w-full bg-transparent py-3.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-zinc-500">{t('drive.noResults')}</p>
          ) : (
            results.map((it, i) => (
              <button
                key={it.id}
                data-active={i === active}
                onMouseMove={() => setActive(i)}
                onClick={it.run}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                  i === active ? 'bg-white/[0.07]' : ''
                }`}
              >
                <it.icon size={16} className="shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-100">{it.label}</span>
                  {it.sub && <span className="block truncate text-xs text-zinc-500">{it.sub}</span>}
                </span>
                {i === active && <CornerDownLeft size={13} className="shrink-0 text-zinc-500" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
