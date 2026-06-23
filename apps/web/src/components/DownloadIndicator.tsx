'use client';

/**
 * Brief "download started" cue: a small pill that rises from the bottom-left and fades. Triggered
 * by signalDownload(name) (see lib/downloadFx). Gives feedback that a download began — handy on
 * mobile/PWA where the browser hides downloads in the notification tray.
 */
import { useEffect, useState } from 'react';
import { DownloadCloud, ArrowDown } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface Cue {
  id: number;
  name: string;
}

export function DownloadIndicator() {
  const { t } = useT();
  const [cues, setCues] = useState<Cue[]>([]);

  useEffect(() => {
    let n = 0;
    const onDl = (e: Event) => {
      const name = (e as CustomEvent<{ name: string }>).detail?.name ?? '';
      const id = ++n;
      setCues((c) => [...c, { id, name }]);
      window.setTimeout(() => setCues((c) => c.filter((x) => x.id !== id)), 1700);
    };
    window.addEventListener('ocl:download', onDl);
    return () => window.removeEventListener('ocl:download', onDl);
  }, []);

  if (cues.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-4 z-[120] flex flex-col-reverse gap-2 sm:left-6">
      {cues.map((c) => (
        <div
          key={c.id}
          className="ocl-dl flex max-w-[14rem] items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-100 shadow-glow backdrop-blur"
        >
          <span className="relative grid h-5 w-5 shrink-0 place-items-center text-violet-200">
            <DownloadCloud size={16} />
            <ArrowDown size={9} className="ocl-dl-arrow absolute" />
          </span>
          <span className="truncate">{c.name || t('download.started')}</span>
        </div>
      ))}
    </div>
  );
}
