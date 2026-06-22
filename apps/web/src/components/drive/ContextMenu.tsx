'use client';

/**
 * Custom right-click context menu. Rendered in a portal at the cursor, clamped to the viewport,
 * and closed on outside-click, Escape, scroll, resize, or another right-click. Reuses the same
 * MenuItem shape as the overflow "⋮" menu so actions stay consistent between the two.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuItem } from '@/components/ui/Menu';

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep the menu fully on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      x: Math.min(x, window.innerWidth - width - pad),
      y: Math.min(y, window.innerHeight - height - pad),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[95] w-52 overflow-hidden rounded-lg border border-white/10 bg-[#15151d] py-1 shadow-2xl ring-1 ring-black/40"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          onClick={() => {
            onClose();
            it.onClick();
          }}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition hover:bg-white/[0.06] ${
            it.danger ? 'text-red-300' : 'text-zinc-200'
          }`}
        >
          <it.icon size={15} className={it.danger ? 'text-red-300' : 'text-zinc-400'} />
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
