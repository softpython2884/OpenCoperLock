'use client';

/**
 * Styled dropdown replacing the native <select>, whose option list renders unstyled (and often
 * dark-on-dark / unreadable) across browsers. Same dark theme as the rest of the app; closes on
 * outside-click or Escape. Drop-in: pass value/onChange/options.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

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
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-sm text-zinc-100 transition hover:border-white/20 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25"
      >
        <span className={`truncate ${current ? '' : 'text-zinc-500'}`}>{current?.label ?? placeholder ?? ''}</span>
        <ChevronDown size={15} className={`shrink-0 text-zinc-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-64 overflow-auto rounded-lg border border-white/10 bg-[#15151d] py-1 shadow-2xl ring-1 ring-black/40">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/[0.06] ${
                o.value === value ? 'text-violet-200' : 'text-zinc-200'
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check size={14} className="shrink-0 text-violet-300" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
