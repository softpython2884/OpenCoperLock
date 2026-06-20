'use client';

/**
 * Admin panel: shows the running version (git SHA), checks GitHub for a newer one, and lets
 * an admin trigger an in-place update. While an update runs, the API restarts mid-flight, so
 * polling tolerates transient network errors and resolves once the status file reports a
 * terminal state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GitCommitHorizontal, RefreshCw, Download, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { confirm, toast } from '@/components/ui/overlays';

interface LocalVersion {
  sha: string | null;
  shortSha: string | null;
  subject: string | null;
  committedAt: string | null;
  branch: string | null;
  isGit: boolean;
}
interface RemoteVersion {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string | null;
  htmlUrl: string;
}
interface UpdateStatus {
  state: 'idle' | 'running' | 'success' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}
interface VersionInfo {
  current: LocalVersion;
  status: UpdateStatus;
  selfUpdateEnabled: boolean;
  repo: string;
  branch: string;
  checked: boolean;
  remote?: RemoteVersion | null;
  updateAvailable?: boolean;
  behindBy?: number | null;
}

export function UpdatePanel() {
  const { t } = useT();
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'update' | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchVersion = useCallback(async (check: boolean) => {
    const res = await api.get<VersionInfo>(`/admin/version${check ? '?check=1' : ''}`);
    setInfo(res);
    return res;
  }, []);

  useEffect(() => {
    void fetchVersion(false).catch((e) => setError(String(e)));
  }, [fetchVersion]);

  // Poll while an update is running (survives the API restart it triggers).
  useEffect(() => {
    const running = info?.status.state === 'running';
    if (running && !pollRef.current) {
      pollRef.current = setInterval(() => {
        void fetchVersion(false).catch(() => {
          /* API likely restarting — ignore and keep polling */
        });
      }, 4000);
    }
    if (!running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [info?.status.state, fetchVersion]);

  async function check() {
    setBusy('check');
    setError(null);
    try {
      await fetchVersion(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runUpdate() {
    const ok = await confirm({
      title: t('admin.updateConfirmTitle'),
      message: t('admin.updateConfirmMsg'),
      confirmLabel: t('admin.updateConfirmBtn'),
    });
    if (!ok) return;
    setBusy('update');
    setError(null);
    try {
      await api.post('/admin/update');
      toast(t('admin.updateStarted'), 'info');
      await fetchVersion(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!info) {
    return (
      <section className="card">
        <h2 className="font-semibold">{t('admin.versionUpdates')}</h2>
        <p className="mt-2 text-sm text-zinc-500">{t('common.loading')}</p>
      </section>
    );
  }

  const { current, status, remote, updateAvailable, behindBy, selfUpdateEnabled } = info;
  const running = status.state === 'running';

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{t('admin.versionUpdates')}</h2>
        <button className="btn-ghost" onClick={check} disabled={busy !== null || running}>
          <RefreshCw size={15} className={busy === 'check' ? 'animate-spin' : ''} /> {t('admin.check')}
        </button>
      </div>

      {/* Current version */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-zinc-400">
          <GitCommitHorizontal size={18} />
        </span>
        <div className="min-w-0">
          {current.isGit ? (
            <>
              <p className="text-sm text-zinc-200">
                {t('admin.currentVersionPre')}{' '}
                <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-zinc-100">
                  {current.shortSha}
                </code>{' '}
                {current.branch && <span className="text-xs text-zinc-500">· {current.branch}</span>}
              </p>
              {current.subject && <p className="truncate text-xs text-zinc-500">{current.subject}</p>}
              {current.committedAt && (
                <p className="text-xs text-zinc-600">{new Date(current.committedAt).toLocaleString()}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-400">
              {t('admin.versionUnknown')}
            </p>
          )}
        </div>
      </div>

      {/* Update status while running / after */}
      {running && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">
          <Loader2 size={15} className="animate-spin" /> {status.message ?? t('admin.updateRunning')}
        </div>
      )}
      {!running && status.state === 'success' && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-200">
          <CheckCircle2 size={15} /> {status.message ?? t('admin.updateSuccess')}
        </div>
      )}
      {!running && status.state === 'failed' && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-sm text-red-300">
          <AlertTriangle size={15} /> {t('admin.updateFailedPre')} {status.message ?? t('admin.updateFailedDefault')}
        </div>
      )}

      {/* Remote comparison (after a check) */}
      {info.checked && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          {remote == null ? (
            <p className="text-sm text-zinc-500">
              {t('admin.githubUnreachable')}
            </p>
          ) : updateAvailable ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-200">
                {t('admin.updateAvailable')}
                {typeof behindBy === 'number' && behindBy > 0 && (
                  <span className="text-zinc-400">{behindBy > 1 ? t('admin.behindMany', { count: behindBy }) : t('admin.behindOne', { count: behindBy })}</span>
                )}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {t('admin.latest')}{' '}
                <a href={remote.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-violet-300 hover:underline">
                  {remote.shortSha}
                </a>{' '}
                {remote.subject}
              </p>
              {selfUpdateEnabled ? (
                <button className="btn-primary" onClick={runUpdate} disabled={busy !== null || running}>
                  <Download size={15} /> {t('admin.updateNow')}
                </button>
              ) : (
                <p className="text-xs text-zinc-500">
                  {t('admin.selfUpdateDisabledPre')}{' '}
                  <code className="font-mono">./scripts/ocl.sh update</code> {t('admin.selfUpdateDisabledPost')}
                </p>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 size={15} /> {t('admin.upToDate')}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}
