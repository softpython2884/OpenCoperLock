'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
          <h1 className="text-lg font-semibold text-white">Une erreur est survenue</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Quelque chose s’est mal passé de notre côté. Vous pouvez réessayer.
          </p>
          {error.digest && <p className="mt-2 font-mono text-xs text-zinc-600">Réf. : {error.digest}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={reset}>
            Réessayer
          </button>
          <Link className="btn-ghost" href="/">
            Accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
