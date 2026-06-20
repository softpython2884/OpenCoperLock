'use client';

/**
 * Full-screen "drop your files here" overlay, shown while the user is dragging files from the
 * desktop anywhere over the window. Purely visual (pointer-events disabled) — the actual drag
 * counting and drop handling live on the Drive page via window-level listeners.
 */
import { UploadCloud } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function DropOverlay({ show }: { show: boolean }) {
  const { t } = useT();
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] grid place-items-center bg-ink-950/80 p-8 backdrop-blur-sm">
      <div className="flex w-full max-w-xl flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-accent/70 bg-accent/[0.06] px-10 py-16 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-2xl bg-accent/20 text-accent">
          <UploadCloud size={40} />
        </span>
        <p className="text-xl font-semibold text-white">{t('drive.dropTitle')}</p>
        <p className="text-sm text-zinc-300">{t('drive.dropHint')}</p>
      </div>
    </div>
  );
}
