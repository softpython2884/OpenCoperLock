'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Logo } from '@/components/Logo';

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
        setError(err.code === 'TOTP_INVALID' ? 'Incorrect code. Try again.' : null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Login failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={48} />
          <div>
            <h1 className="text-xl font-semibold text-white">OpenCoperLock</h1>
            <p className="mt-1 text-sm text-zinc-500">Connectez-vous à votre cloud privé</p>
          </div>
        </div>
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
            Password
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
              Two-factor code
            </label>
            <input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="input tracking-widest"
              placeholder="123456 or recovery code"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              autoFocus
            />
            <p className="mt-1 text-xs text-neutral-400">
              Enter the 6-digit code from your authenticator app, or a recovery code.
            </p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : needTotp ? 'Verify' : 'Sign in'}
        </button>
        <p className="text-center text-xs text-neutral-400">
          Have a Quick-Upload code?{' '}
          <a href="/q" className="text-accent hover:underline">
            Use it here
          </a>
        </p>
      </form>
    </div>
  );
}
