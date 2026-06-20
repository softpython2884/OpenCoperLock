'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useT();
  useEffect(() => {
    // Surface the error for diagnostics; the operator can read it from the browser console.
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-500/10 text-red-400">
          <AlertTriangle size={30} />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-white">{t('error.title')}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t('error.message')}
          </p>
          {error.digest && <p className="mt-2 font-mono text-xs text-zinc-600">{t('error.ref', { digest: error.digest })}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={reset}>
            {t('error.retry')}
          </button>
          <Link className="btn-ghost" href="/">
            {t('error.home')}
          </Link>
        </div>
      </div>
    </div>
  );
}
