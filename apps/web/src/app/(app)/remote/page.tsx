'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicRemoteJob } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function RemotePage() {
  const { t } = useT();
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
      setError(err instanceof ApiError ? err.message : t('remote.enqueueFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{t('remote.title')}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {t('remote.subtitlePre')}{' '}
          <span className="font-medium text-zinc-300">{t('remote.subtitleFolder')}</span>
          {t('remote.subtitlePost')}
        </p>
      </div>

      <div className="card">
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            type="url"
            placeholder={t('remote.placeholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button className="btn-primary whitespace-nowrap" disabled={busy}>
            {busy ? t('remote.enqueueing') : t('remote.download')}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">{t('remote.jobs')}</h2>
        {jobs.length === 0 ? (
          <div className="card py-10 text-center text-sm text-zinc-500">{t('remote.noJobs')}</div>
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
                  <JobStatus status={job.status} t={t} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobStatus({ status, t }: { status: PublicRemoteJob['status']; t: (key: string) => string }) {
  const map: Record<PublicRemoteJob['status'], string> = {
    QUEUED: 'bg-white/[0.06] text-zinc-400',
    RUNNING: 'bg-amber-500/10 text-amber-300',
    DONE: 'bg-emerald-500/10 text-emerald-300',
    FAILED: 'bg-red-500/10 text-red-300',
  };
  const label: Record<PublicRemoteJob['status'], string> = {
    QUEUED: t('remote.statusQueued'),
    RUNNING: t('remote.statusRunning'),
    DONE: t('remote.statusDone'),
    FAILED: t('remote.statusFailed'),
  };
  return <span className={`rounded px-2 py-0.5 font-medium uppercase tracking-wide ${map[status]}`}>{label[status]}</span>;
}
