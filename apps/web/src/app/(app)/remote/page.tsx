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
      <div className="card space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Remote-Upload</h1>
          <p className="text-sm text-neutral-500">
            Paste a link and the server downloads it directly — your own connection stays free.
            Files are antivirus-scanned and encrypted at rest.
          </p>
        </div>
        <form onSubmit={submit} className="flex gap-2">
          <input
            className="input"
            type="url"
            placeholder="https://example.com/large-file.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button className="btn-primary whitespace-nowrap" disabled={busy}>
            {busy ? 'Queuing…' : 'Fetch'}
          </button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="card p-0">
        <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium dark:border-neutral-800">
          Jobs
        </div>
        {jobs.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-400">No remote uploads yet.</p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{job.sourceUrl}</p>
                  {job.error && <p className="text-xs text-red-600">{job.error}</p>}
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap text-xs">
                  {job.sizeBytes != null && (
                    <span className="text-neutral-400">{formatBytes(job.sizeBytes)}</span>
                  )}
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
    QUEUED: 'bg-neutral-100 text-neutral-600',
    RUNNING: 'bg-amber-100 text-amber-700',
    DONE: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
  };
  return <span className={`rounded px-2 py-0.5 uppercase ${map[status]}`}>{status}</span>;
}
