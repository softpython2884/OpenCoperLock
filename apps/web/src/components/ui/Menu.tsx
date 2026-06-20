'use client';

/**
 * Compact "⋮" overflow menu for row actions. Keeps rows uncluttered (especially on mobile,
 * where a long strip of icon buttons hides the filename) by tucking secondary actions behind
 * a single button. Closes on outside-click or Escape.
 */
import { useEffect, useRef, useState } from 'react';
import { MoreVertical, type LucideIcon } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

export function Menu({ items, label = 'Plus d’actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        title={label}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-[#111118] py-1 shadow-xl">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition hover:bg-white/[0.05] ${
                it.danger ? 'text-red-300' : 'text-zinc-200'
              }`}
            >
              <it.icon size={15} className={it.danger ? 'text-red-300' : 'text-zinc-400'} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
