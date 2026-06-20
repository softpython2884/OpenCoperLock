'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { Wordmark } from '@/components/Wordmark';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password, needTotp ? totp : undefined);
      router.replace('/drive');
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'TOTP_REQUIRED' || err.code === 'TOTP_INVALID')) {
        setNeedTotp(true);
        setError(err.code === 'TOTP_INVALID' ? 'Code incorrect. Réessayez.' : null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Connexion impossible');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex flex-col items-center gap-4 text-center">
            <Logo size={52} />
            <div>
              <Wordmark className="text-2xl" />
              <p className="mt-2 text-sm text-zinc-500">Connectez-vous à votre cloud privé</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="card space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {needTotp && (
              <div>
                <label className="label" htmlFor="totp">
                  Code à deux facteurs
                </label>
                <input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="input tracking-widest"
                  placeholder="123456 ou code de secours"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  autoFocus
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  Saisissez le code à 6 chiffres de votre application, ou un code de secours.
                </p>
              </div>
            )}
            {error && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Connexion…' : needTotp ? 'Vérifier' : 'Se connecter'}
            </button>
          </form>

          <Link
            href="/q"
            className="mt-3 flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-sm text-zinc-300 transition hover:border-accent/40 hover:bg-white/[0.04]"
          >
            <span className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-violet-300" />
              Vous avez un code Quick-Upload ?
            </span>
            <ArrowUpRight size={16} className="text-zinc-500" />
          </Link>
        </div>
      </div>

      <footer className="border-t border-white/[0.06] px-4 py-5">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center text-xs text-zinc-500">
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            <Link href="/legal" className="hover:text-zinc-300">À propos</Link>
            <Link href="/legal/terms" className="hover:text-zinc-300">Conditions</Link>
            <Link href="/legal/privacy" className="hover:text-zinc-300">Confidentialité</Link>
            <Link href="/legal/license" className="hover:text-zinc-300">Licence</Link>
          </nav>
          <p>
            Open-source (AGPLv3) · par{' '}
            <a href="https://forgenet.fr" target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
              Forge Network
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
