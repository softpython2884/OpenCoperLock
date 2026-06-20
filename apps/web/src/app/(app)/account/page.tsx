'use client';

/**
 * Account security: two-factor (TOTP) setup with a QR code and one-time recovery codes,
 * and a list of active sessions (with IP / user-agent) that the user can revoke.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { prompt } from '@/components/ui/overlays';

interface TwoFaStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}
interface SetupData {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}
interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export default function AccountPage() {
  const { refresh } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const [status, setStatus] = useState<TwoFaStatus | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [token, setToken] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, sess] = await Promise.all([
      api.get<TwoFaStatus>('/2fa/status'),
      api.get<{ sessions: SessionInfo[] }>('/auth/sessions'),
    ]);
    setStatus(s);
    setSessions(sess.sessions);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [load]);

  async function wrap(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  async function beginSetup() {
    await wrap(async () => setSetup(await api.post<SetupData>('/2fa/setup')));
  }

  async function enable() {
    await wrap(async () => {
      const res = await api.post<{ recoveryCodes: string[] }>('/2fa/enable', { token });
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setToken('');
      await load();
    });
  }

  async function disable() {
    const password = await prompt({ title: t('account.disable2faTitle'), label: t('account.confirmPassword'), password: true });
    if (!password) return;
    await wrap(async () => {
      await api.post('/2fa/disable', { password });
      setRecoveryCodes(null);
      await load();
    });
  }

  async function regenerate() {
    const password = await prompt({ title: t('account.regenTitle'), label: t('account.confirmPassword'), password: true });
    if (!password) return;
    await wrap(async () => {
      const res = await api.post<{ recoveryCodes: string[] }>('/2fa/recovery/regenerate', { password });
      setRecoveryCodes(res.recoveryCodes);
      await load();
    });
  }

  async function revoke(id: string) {
    await wrap(async () => {
      await api.del(`/auth/sessions/${id}`);
      await load();
    });
  }
  async function revokeOthers() {
    await wrap(async () => {
      await api.del('/auth/sessions');
      await load();
    });
  }

  async function deleteAccount() {
    const password = await prompt({
      title: t('account.deleteTitle'),
      message: t('account.deleteMsg'),
      label: t('account.confirmPassword'),
      password: true,
    });
    if (!password) return;
    await wrap(async () => {
      await api.post('/account/delete', { password });
      await refresh();
      router.replace('/login');
    });
  }

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold">{t('account.title')}</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Two-factor */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('account.twoFa')}</h2>
          <span className="text-xs text-neutral-400">
            {status?.enabled ? t('account.twoFaOn', { count: status.recoveryCodesRemaining }) : t('account.twoFaOff')}
          </span>
        </div>

        {recoveryCodes && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-200">
              {t('account.saveCodes')}
            </p>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm">
              {recoveryCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
        )}

        {!status?.enabled && !setup && (
          <button className="btn-primary" onClick={beginSetup}>
            {t('account.enable2fa')}
          </button>
        )}

        {!status?.enabled && setup && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">
              {t('account.scanHint')}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt={t('account.qrAlt')} className="h-44 w-44 rounded bg-white p-2" />
            <p className="break-all text-xs text-neutral-400">
              {t('account.manualSecret')} <code className="font-mono">{setup.secret}</code>
            </p>
            <div className="flex gap-2">
              <input
                className="input max-w-[10rem] tracking-widest"
                inputMode="numeric"
                placeholder="123456"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button className="btn-primary" onClick={enable}>
                {t('account.verifyEnable')}
              </button>
            </div>
          </div>
        )}

        {status?.enabled && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={regenerate}>
              {t('account.regenCodes')}
            </button>
            <button className="btn-danger" onClick={disable}>
              {t('account.disable2fa')}
            </button>
          </div>
        )}
      </section>

      {/* Sessions */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('account.sessions')}</h2>
          <button className="btn-ghost px-2 py-1" onClick={revokeOthers}>
            {t('account.signoutOthers')}
          </button>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate">
                  {s.ip ?? t('account.unknownIp')}
                  {s.current && <span className="ml-2 text-xs text-accent">{t('account.thisDevice')}</span>}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {s.userAgent ?? t('account.unknownDevice')} · {t('account.lastSeen', { date: new Date(s.lastSeenAt).toLocaleString() })}
                </p>
              </div>
              {!s.current && (
                <button className="btn-danger px-2 py-1" onClick={() => revoke(s.id)}>
                  {t('account.revoke')}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Data & privacy (GDPR) */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('account.yourData')}</h2>
        <p className="text-sm text-neutral-500">
          {t('account.dataHint')}
        </p>
        <div className="flex gap-2">
          <a className="btn-ghost" href={`${API_URL}/account/export`}>
            {t('account.exportData')}
          </a>
          <button className="btn-danger" onClick={deleteAccount}>
            {t('account.deleteAccount')}
          </button>
        </div>
      </section>
    </div>
  );
}
