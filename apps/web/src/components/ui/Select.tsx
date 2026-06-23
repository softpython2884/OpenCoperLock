'use client';

/**
 * Styled dropdown replacing the native <select>, whose option list renders unstyled (and often
 * dark-on-dark / unreadable) across browsers.
 *
 * The open list is rendered in a PORTAL at a fixed position anchored to the trigger. This is
 * deliberate: `.card` uses backdrop-blur, which creates a stacking context per card, so an
 * in-flow absolutely-positioned menu would be painted UNDER later cards. A portal escapes that.
 * Closes on outside-click, Escape, scroll or resize.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const current = options.find((o) => o.value === value);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width });
  };

  // After the menu mounts, flip it above the trigger if it would overflow the viewport bottom.
  useLayoutEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    const mh = menuRef.current?.offsetHeight ?? 0;
    if (!r) return;
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    setPos({ left: r.left, top, width: r.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!open) place();
          setOpen((o) => !o);
        }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-sm text-zinc-100 transition hover:border-white/20 focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/25"
      >
        <span className={`truncate ${current ? '' : 'text-zinc-500'}`}>{current?.label ?? placeholder ?? ''}</span>
        <ChevronDown size={15} className={`shrink-0 text-zinc-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            style={{ left: pos.left, top: pos.top, width: pos.width }}
            className="fixed z-[95] max-h-64 overflow-auto rounded-lg border border-white/10 bg-[#15151d] py-1 shadow-2xl ring-1 ring-black/40"
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
