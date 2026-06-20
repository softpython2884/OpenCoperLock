'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicRemoteJob } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';

export default function RemotePage() {
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState<PublicRemoteJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<{ jobs: PublicRemoteJob[] }>('/remote');
    setJobs(res.jobs);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while any job is still in flight.
  useEffect(() => {
    const active = jobs.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
    if (!active) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [jobs, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/remote', { sourceUrl: url });
      setUrl('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to enqueue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Remote-Upload</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Collez un lien : le serveur le télécharge directement (votre connexion reste libre).
          Les fichiers sont analysés et chiffrés au repos, puis rangés dans votre dossier{' '}
          <span className="font-medium text-zinc-300">Remote-Upload</span>.
        </p>
      </div>

      <div className="card">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            type="url"
            placeholder="https://example.com/gros-fichier.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button className="btn-primary whitespace-nowrap" disabled={busy}>
            {busy ? 'En file…' : 'Télécharger'}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">Tâches</h2>
        {jobs.length === 0 ? (
          <div className="card py-10 text-center text-sm text-zinc-500">Aucun téléchargement distant pour l’instant.</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => (
              <div key={job.id} className="row">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-200">{job.sourceUrl}</p>
                  {job.error && <p className="truncate text-xs text-red-300">{job.error}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs">
                  {job.sizeBytes != null && <span className="text-zinc-500">{formatBytes(job.sizeBytes)}</span>}
                  <JobStatus status={job.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobStatus({ status }: { status: PublicRemoteJob['status'] }) {
  const map: Record<PublicRemoteJob['status'], string> = {
    QUEUED: 'bg-white/[0.06] text-zinc-400',
    RUNNING: 'bg-amber-500/10 text-amber-300',
    DONE: 'bg-emerald-500/10 text-emerald-300',
    FAILED: 'bg-red-500/10 text-red-300',
  };
  const label: Record<PublicRemoteJob['status'], string> = {
    QUEUED: 'En file',
    RUNNING: 'En cours',
    DONE: 'Terminé',
    FAILED: 'Échec',
  };
  return <span className={`rounded px-2 py-0.5 font-medium uppercase tracking-wide ${map[status]}`}>{label[status]}</span>;
}
