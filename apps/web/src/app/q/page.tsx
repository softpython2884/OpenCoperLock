'use client';

import { useRef, useState } from 'react';
import { API_URL } from '@/lib/api';
import { Logo } from '@/components/Logo';

/**
 * Standalone, login-free Quick-Upload page. A guest enters an active code, optionally a
 * password, and drops files. Everything is uploaded server-side-encrypted and scanned.
 */
export default function QuickUploadPage() {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [validated, setValidated] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${API_URL}/quick/${encodeURIComponent(code.trim())}`);
      if (!res.ok) throw new Error('Code not found or no longer active');
      const data = (await res.json()) as { requiresPassword: boolean };
      setRequiresPassword(data.requiresPassword);
      setValidated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
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
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
        count += 1;
      }
      setStatus(`Uploaded ${count} file${count > 1 ? 's' : ''} ✓`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="card w-full max-w-md space-y-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo size={44} />
          <h1 className="text-xl font-semibold text-white">Quick-Upload</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Enter an active code to open a temporary drop zone.
          </p>
        </div>

        {!validated ? (
          <form onSubmit={check} className="space-y-3">
            <input
              className="input text-center font-mono uppercase tracking-widest"
              placeholder="CODE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
            />
            <button className="btn-primary w-full">Continue</button>
          </form>
        ) : (
          <div className="space-y-3">
            {requiresPassword && (
              <div>
                <label className="label">Drop-zone password</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
            <button
              className="btn-primary w-full"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? 'Uploading…' : 'Choose files to upload'}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
            <button className="btn-ghost w-full" onClick={() => setValidated(false)}>
              Use a different code
            </button>
          </div>
        )}

        {status && <p className="text-center text-sm text-green-600">{status}</p>}
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
