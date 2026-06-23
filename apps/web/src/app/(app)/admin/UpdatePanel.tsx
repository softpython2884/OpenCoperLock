'use client';

/**
 * Admin panel: shows the running version (git SHA), checks GitHub for a newer one, and lets
 * an admin trigger an in-place update. While an update runs, the API restarts mid-flight, so
 * polling tolerates transient network errors and resolves once the status file reports a
 * terminal state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GitCommitHorizontal, RefreshCw, Download, CheckCircle2, AlertTriangle, Loader2, History, RotateCcw } from 'lucide-react';
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
interface HistoryCommit {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string | null;
}
interface VersionInfo {
  current: LocalVersion;
  status: UpdateStatus;
  stuck?: boolean;
  selfUpdateEnabled: boolean;
  autoUpdateEnabled: boolean;
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
  const [history, setHistory] = useState<HistoryCommit[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set when THIS admin starts an update/rollback, so we reload the page once it succeeds
  // (the API has restarted on the new build) — which then surfaces the "What's new" dialog.
  const initiated = useRef(false);

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
    // Poll only while an update is ACTUALLY in progress — not when the status is stuck/stale,
    // otherwise the 4s poll (check=false) keeps wiping a "Check for updates" result.
    const running = info?.status.state === 'running' && !info?.stuck;
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
  }, [info?.status.state, info?.stuck, fetchVersion]);

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

  // When an update/rollback this admin started finishes successfully, the API is now running the
  // new build — reload so the browser fetches the new bundle (and the What's-new dialog appears).
  useEffect(() => {
    if (info?.status.state === 'success' && initiated.current) {
      initiated.current = false;
      toast(t('admin.updateReloading'), 'info');
      const id = setTimeout(() => window.location.reload(), 1800);
      return () => clearTimeout(id);
    }
  }, [info?.status.state, t]);

  async function loadHistory() {
    if (history) {
      setShowHistory((s) => !s);
      return;
    }
    try {
      const res = await api.get<{ history: HistoryCommit[]; currentSha: string | null }>('/admin/version/history');
      setHistory(res.history);
      setShowHistory(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function rollback(commit: HistoryCommit) {
    const ok = await confirm({
      title: t('admin.rollbackConfirmTitle'),
      message: t('admin.rollbackConfirmMsg', { sha: commit.shortSha, subject: commit.subject }),
      confirmLabel: t('admin.rollbackConfirmBtn'),
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await api.post('/admin/rollback', { sha: commit.sha });
      initiated.current = true;
      toast(t('admin.rollbackStarted'), 'info');
      await fetchVersion(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function toggleAuto() {
    if (!info) return;
    try {
      await api.patch('/admin/settings', { autoUpdateEnabled: !info.autoUpdateEnabled });
      await fetchVersion(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
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
      initiated.current = true;
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

  const { current, status, remote, updateAvailable, behindBy, selfUpdateEnabled, autoUpdateEnabled } = info;
  // A stuck "running" status (e.g. a previous update killed mid-flight) must not lock the panel.
  const stuck = !!info.stuck;
  const running = status.state === 'running' && !stuck;

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
      {stuck && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} /> {t('admin.updateStuck')}
          </span>
          {selfUpdateEnabled && (
            <button className="btn-primary ml-auto px-2.5 py-1 text-xs" onClick={runUpdate} disabled={busy !== null}>
              <Download size={14} /> {t('admin.updateRelaunch')}
            </button>
          )}
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

      {/* Version history / rollback */}
      {selfUpdateEnabled && current.isGit && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.02]">
          <button
            type="button"
            onClick={loadHistory}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm text-zinc-200"
          >
            <span className="flex items-center gap-2">
              <History size={15} className="text-zinc-400" /> {t('admin.rollbackTitle')}
            </span>
            <span className="text-xs text-zinc-500">{showHistory ? t('admin.hide') : t('admin.show')}</span>
          </button>
          {showHistory && history && (
            <div className="border-t border-white/[0.06] p-2">
              <p className="px-1 pb-2 text-xs text-zinc-500">{t('admin.rollbackHint')}</p>
              <div className="space-y-1">
                {history.map((c) => {
                  const isCurrent = c.sha === current.sha;
                  return (
                    <div key={c.sha} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
                      <code className="shrink-0 font-mono text-xs text-zinc-400">{c.shortSha}</code>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{c.subject}</span>
                      {isCurrent ? (
                        <span className="shrink-0 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300">
                          {t('admin.rollbackCurrent')}
                        </span>
                      ) : (
                        <button
                          className="btn-ghost shrink-0 px-2 py-1 text-xs"
                          onClick={() => rollback(c)}
                          disabled={busy !== null || running}
                        >
                          <RotateCcw size={13} /> {t('admin.rollbackTo')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Automatic updates */}
      {selfUpdateEnabled && (
        <button
          type="button"
          onClick={toggleAuto}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left transition hover:border-white/15"
        >
          <span className="min-w-0">
            <span className="block text-sm text-zinc-200">{t('admin.autoUpdate')}</span>
            <span className="block text-xs text-zinc-500">{t('admin.autoUpdateHint')}</span>
          </span>
          <span
            className={`relative h-5 w-9 shrink-0 rounded-full transition ${autoUpdateEnabled ? 'bg-accent' : 'bg-white/15'}`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${autoUpdateEnabled ? 'left-[18px]' : 'left-0.5'}`}
            />
          </span>
        </button>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}
