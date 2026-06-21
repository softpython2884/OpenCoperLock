'use client';

/** Keyboard-shortcut cheat-sheet, toggled with "?" from the Drive page. */
import { Keyboard, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

/** ⌘ on Apple platforms, Ctrl elsewhere — matches what the handlers actually accept. */
export function modKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.6rem] items-center justify-center rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">
      {children}
    </kbd>
  );
}

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const m = modKey();
  const rows: { keys: string[]; label: string }[] = [
    { keys: [m, 'K'], label: t('drive.scSearch') },
    { keys: ['↑', '↓'], label: t('drive.scNavigate') },
    { keys: ['Enter'], label: t('drive.scOpen') },
    { keys: ['Backspace'], label: t('drive.scParent') },
    { keys: [m, 'A'], label: t('drive.scSelectAll') },
    { keys: [m, '+ clic'], label: t('drive.scToggle') },
    { keys: ['Shift', '+ clic'], label: t('drive.scRange') },
    { keys: ['F2'], label: t('drive.scRename') },
    { keys: ['Delete'], label: t('drive.scTrash') },
    { keys: [m, 'C'], label: t('drive.scCopy') },
    { keys: [m, 'X'], label: t('drive.scCut') },
    { keys: [m, 'V'], label: t('drive.scPaste') },
    { keys: [m, 'D'], label: t('drive.scDuplicate') },
    { keys: ['Esc'], label: t('drive.scClear') },
    { keys: ['?'], label: t('drive.scHelp') },
  ];
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#15151d] p-5 shadow-2xl ring-1 ring-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard size={18} className="text-violet-300" />
            <h3 className="font-semibold text-zinc-100">{t('drive.shortcutsTitle')}</h3>
          </div>
          <button className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-100" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3">
              <span className="text-sm text-zinc-400">{r.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {r.keys.map((k) => (
                  <Key key={k}>{k}</Key>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
