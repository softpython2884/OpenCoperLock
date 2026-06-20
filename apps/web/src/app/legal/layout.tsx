import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Wordmark } from '@/components/Wordmark';

/** Shared shell for the legal / about pages: centered column, brand header, footer credit. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/" className="transition hover:opacity-80">
            <Wordmark />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-100"
          >
            <ArrowLeft size={15} /> Connexion
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <article className="legal-prose space-y-4">{children}</article>

        <footer className="mt-12 border-t border-white/[0.06] pt-6 text-sm text-zinc-500">
          <p>
            OpenCoperLock — logiciel libre sous licence{' '}
            <Link href="/legal/license" className="text-violet-300 hover:underline">
              GNU AGPLv3
            </Link>
            . Créé et maintenu par{' '}
            <a href="https://forgenet.fr" target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
              Forge Network
            </a>{' '}
            (forgenet.fr).
          </p>
          <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/legal" className="hover:text-zinc-300">À propos</Link>
            <Link href="/legal/terms" className="hover:text-zinc-300">Conditions d’utilisation</Link>
            <Link href="/legal/privacy" className="hover:text-zinc-300">Confidentialité</Link>
            <Link href="/legal/license" className="hover:text-zinc-300">Licence</Link>
          </nav>
        </footer>
      </main>
    </div>
  );
}
