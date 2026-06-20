'use client';

// Catches errors thrown in the root layout itself. It must render its own <html>/<body>.
import './globals.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr" className="dark">
      <body className="min-h-screen font-sans">
        <div className="grid min-h-screen place-items-center px-4">
          <div className="flex max-w-md flex-col items-center gap-5 text-center">
            <h1 className="text-lg font-semibold text-white">Erreur critique</h1>
            <p className="text-sm text-zinc-500">
              L’application n’a pas pu démarrer. Rechargez la page ou réessayez.
            </p>
            {error.digest && <p className="font-mono text-xs text-zinc-600">Réf. : {error.digest}</p>}
            <button className="btn-primary" onClick={reset}>
              Réessayer
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
