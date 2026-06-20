'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { UploadCloud, CheckCircle2 } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Logo } from '@/components/Logo';
import { Wordmark } from '@/components/Wordmark';

/**
 * Standalone, login-free Quick-Upload page. A guest enters an active code, optionally a
 * password, and drops files. Everything is uploaded server-side-encrypted and scanned, and
 * lands in the code owner's Fast-Upload folder.
 */
export default function QuickUploadPage() {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [validated, setValidated] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${API_URL}/quick/${encodeURIComponent(code.trim())}`);
      if (!res.ok) throw new Error(t('quick.codeNotFound'));
      const data = (await res.json()) as { requiresPassword: boolean };
      setRequiresPassword(data.requiresPassword);
      setValidated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quick.codeInvalid'));
      setValidated(false);
    }
  }

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      let count = 0;
      for (const file of Array.from(list)) {
        const form = new FormData();
        if (requiresPassword) form.append('password', password);
        form.append('file', file);
        const res = await fetch(`${API_URL}/quick/${encodeURIComponent(code.trim())}`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? t('quick.uploadFailedStatus', { status: res.status }));
        }
        count += 1;
      }
      setStatus(count > 1 ? t('quick.sentMany', { count }) : t('quick.sentOne', { count }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quick.uploadFailed'));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Logo size={46} />
            <h1 className="text-xl font-semibold text-white">{t('quick.title')}</h1>
            <p className="text-sm text-zinc-500">
              {t('quick.subtitle')}
            </p>
          </div>

          <div className="card space-y-4">
            {!validated ? (
              <form onSubmit={check} className="space-y-3">
                <input
                  className="input text-center font-mono text-lg uppercase tracking-[0.3em]"
                  placeholder={t('quick.codePlaceholder')}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                />
                <button className="btn-primary w-full">{t('quick.continue')}</button>
              </form>
            ) : (
              <div className="space-y-3">
                {requiresPassword && (
                  <div>
                    <label className="label">{t('quick.areaPassword')}</label>
                    <input
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void upload(e.dataTransfer.files);
                  }}
                  disabled={busy}
                  className={`flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-sm transition ${
                    dragging ? 'border-accent/60 bg-accent/[0.05] text-zinc-200' : 'border-white/10 text-zinc-400 hover:border-white/20'
                  } disabled:opacity-60`}
                >
                  <UploadCloud size={26} className="text-violet-300" />
                  {busy ? t('quick.uploading') : t('quick.dropHint')}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => upload(e.target.files)}
                />
                <button className="btn-ghost w-full" onClick={() => setValidated(false)}>
                  {t('quick.useAnotherCode')}
                </button>
              </div>
            )}

            {status && (
              <p className="flex items-center justify-center gap-2 text-sm text-emerald-400">
                <CheckCircle2 size={16} /> {status}
              </p>
            )}
            {error && <p className="text-center text-sm text-red-300">{error}</p>}
          </div>

          <p className="mt-4 text-center text-sm text-zinc-500">
            <Link href="/login" className="text-violet-300 hover:underline">
              {t('quick.backToLogin')}
            </Link>
          </p>
        </div>
      </div>

      <footer className="border-t border-white/[0.06] px-4 py-4 text-center text-xs text-zinc-500">
        {t('quick.poweredBy')} <Wordmark className="!text-xs" /> ·{' '}
        <a href="https://forgenet.fr" target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
          Forge Network
        </a>
      </footer>
    </div>
  );
}
