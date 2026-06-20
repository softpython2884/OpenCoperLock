import Link from 'next/link';
import { Compass } from 'lucide-react';
import { Wordmark } from '@/components/Wordmark';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="flex max-w-md flex-col items-center gap-5 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent-soft text-violet-300">
          <Compass size={30} />
        </span>
        <div>
          <p className="text-5xl font-semibold tracking-tight text-white">404</p>
          <h1 className="mt-2 text-lg font-medium text-zinc-200">Page introuvable</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Cette page n’existe pas ou a été déplacée. Vérifiez l’adresse ou revenez à l’accueil.
          </p>
        </div>
        <Link href="/" className="btn-primary">
          Retour à l’accueil
        </Link>
        <Wordmark className="!text-sm opacity-60" />
      </div>
    </div>
  );
}
