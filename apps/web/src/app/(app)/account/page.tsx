'use client';

/**
 * Account security: two-factor (TOTP) setup with a QR code and one-time recovery codes,
 * and a list of active sessions (with IP / user-agent) that the user can revoke.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicQuickCode, PublicFolder, PublicApiToken, PublicWebhook } from '@opencoperlock/shared/client';
import { api, API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { prompt, toast } from '@/components/ui/overlays';
import { Select } from '@/components/ui/Select';
import { Monitor, Smartphone } from 'lucide-react';
import { parseUserAgent } from '@/lib/userAgent';

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
  const [codes, setCodes] = useState<PublicQuickCode[]>([]);
  const [folders, setFolders] = useState<PublicFolder[]>([]);
  const [nc, setNc] = useState({ code: '', targetFolderId: '', usageLimit: '' });
  const [tokens, setTokens] = useState<PublicApiToken[]>([]);
  const [nt, setNt] = useState<{ name: string; scopes: ('read' | 'write')[]; folderId: string; expiresInDays: string }>({
    name: '',
    scopes: ['write'],
    folderId: '',
    expiresInDays: '',
  });
  const [newToken, setNewToken] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<PublicWebhook[]>([]);
  const [nw, setNw] = useState({ url: '', secret: '', folderId: '' });
  const [autoDelete, setAutoDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, sess, qc, fl, tk, wh, ad] = await Promise.all([
      api.get<TwoFaStatus>('/2fa/status'),
      api.get<{ sessions: SessionInfo[] }>('/auth/sessions'),
      api.get<{ codes: PublicQuickCode[] }>('/account/quick-codes'),
      api.get<{ folders: PublicFolder[] }>('/folders'),
      api.get<{ tokens: PublicApiToken[] }>('/account/api-tokens'),
      api.get<{ webhooks: PublicWebhook[] }>('/account/webhooks'),
      api.get<{ autoDeleteAfterDays: number | null }>('/account/auto-delete'),
    ]);
    setStatus(s);
    setSessions(sess.sessions);
    setCodes(qc.codes);
    setFolders(fl.folders);
    setTokens(tk.tokens);
    setWebhooks(wh.webhooks);
    setAutoDelete(ad.autoDeleteAfterDays);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [load]);

  // Normal (non-vault) folders as dropdown options — vaults can't be API/quick/webhook targets.
  const folderOptions = folders.filter((f) => !f.isZeroKnowledge).map((f) => ({ value: f.id, label: f.name }));

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

  async function wipeSpaces() {
    const password = await prompt({
      title: t('account.wipeTitle'),
      message: t('account.wipeMsg'),
      label: t('account.confirmPassword'),
      password: true,
    });
    if (!password) return;
    await wrap(async () => {
      await api.post('/account/wipe', { password });
      await refresh();
      toast(t('account.wipeDone'), 'success');
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
          {sessions.map((s) => {
            const ua = parseUserAgent(s.userAgent);
            const DeviceIcon = ua.mobile ? Smartphone : Monitor;
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.04] text-zinc-400">
                    <DeviceIcon size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium">
                      <span className="truncate" title={s.userAgent ?? undefined}>
                        {s.userAgent ? ua.label : t('account.unknownDevice')}
                      </span>
                      {s.current && <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11px] text-violet-300">{t('account.thisDevice')}</span>}
                    </p>
                    <p className="truncate text-xs text-neutral-400">
                      {s.ip ?? t('account.unknownIp')} · {t('account.lastSeen', { date: new Date(s.lastSeenAt).toLocaleString() })}
                    </p>
                  </div>
                </div>
                {!s.current && (
                  <button className="btn-danger shrink-0 px-2 py-1" onClick={() => revoke(s.id)}>
                    {t('account.revoke')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Quick-Upload codes */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('account.quickCodes')}</h2>
        <p className="text-sm text-neutral-500">{t('account.quickCodesHint')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className="input max-w-[12rem] font-mono uppercase tracking-wide"
            placeholder={t('account.quickCodePlaceholder')}
            value={nc.code}
            onChange={(e) => setNc({ ...nc, code: e.target.value.toUpperCase() })}
          />
          <Select
            className="w-[14rem]"
            value={nc.targetFolderId}
            onChange={(v) => setNc({ ...nc, targetFolderId: v })}
            options={[{ value: '', label: t('account.quickCodeDefaultFolder') }, ...folderOptions]}
          />
          <input
            className="input max-w-[9rem]"
            type="number"
            min={1}
            placeholder={t('account.quickCodeUsageLimit')}
            value={nc.usageLimit}
            onChange={(e) => setNc({ ...nc, usageLimit: e.target.value })}
          />
          <button
            className="btn-primary"
            onClick={() =>
              wrap(async () => {
                await api.post('/account/quick-codes', {
                  code: nc.code.trim() || undefined,
                  targetFolderId: nc.targetFolderId || null,
                  usageLimit: Number(nc.usageLimit) || null,
                });
                setNc({ code: '', targetFolderId: '', usageLimit: '' });
              })
            }
          >
            {t('account.quickCodeCreate')}
          </button>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {codes.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">{c.code}</code>{' '}
                <span className="text-xs text-neutral-400">
                  {c.usageLimit !== null
                    ? t('account.quickUsedLimited', { count: c.usageCount, limit: c.usageLimit })
                    : t('account.quickUsed', { count: c.usageCount })}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(`${window.location.origin}/q?code=${encodeURIComponent(c.code)}`).catch(() => {});
                    toast(t('account.quickLinkCopied'), 'success');
                  }}
                >
                  {t('account.quickCopyLink')}
                </button>
                <button className="btn-danger px-2 py-1" onClick={() => wrap(() => api.del(`/account/quick-codes/${c.id}`))}>
                  {t('account.revoke')}
                </button>
              </div>
            </div>
          ))}
          {codes.length === 0 && <p className="py-2 text-sm text-neutral-400">{t('account.noQuickCodes')}</p>}
        </div>
      </section>

      {/* Webhooks */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('account.webhooks')}</h2>
        <p className="text-sm text-neutral-500">{t('account.webhooksHint')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className="input min-w-[16rem] flex-1"
            placeholder="https://exemple.com/hook"
            value={nw.url}
            onChange={(e) => setNw({ ...nw, url: e.target.value })}
          />
          <input
            className="input max-w-[12rem]"
            placeholder={t('account.webhookSecret')}
            value={nw.secret}
            onChange={(e) => setNw({ ...nw, secret: e.target.value })}
          />
          <Select
            className="w-[13rem]"
            value={nw.folderId}
            onChange={(v) => setNw({ ...nw, folderId: v })}
            options={[{ value: '', label: t('account.webhookAnyFolder') }, ...folderOptions]}
          />
          <button
            className="btn-primary"
            disabled={!nw.url.trim()}
            onClick={() =>
              wrap(async () => {
                await api.post('/account/webhooks', {
                  url: nw.url.trim(),
                  secret: nw.secret.trim() || undefined,
                  folderId: nw.folderId || null,
                });
                setNw({ url: '', secret: '', folderId: '' });
                await load();
              })
            }
          >
            {t('account.webhookCreate')}
          </button>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {webhooks.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-zinc-200">{w.url}</p>
                <p className="text-xs text-neutral-400">
                  {w.hasSecret ? t('account.webhookSigned') : t('account.webhookUnsigned')}
                  {w.lastStatus !== null
                    ? ` · ${w.lastError ? t('account.webhookLastError', { error: w.lastError }) : t('account.webhookLastOk', { status: w.lastStatus })}`
                    : ` · ${t('account.webhookNeverFired')}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => wrap(() => api.post(`/account/webhooks/${w.id}/test`).then(load))}>
                  {t('account.webhookTest')}
                </button>
                <button className="btn-danger px-2 py-1" onClick={() => wrap(() => api.del(`/account/webhooks/${w.id}`).then(load))}>
                  {t('account.revoke')}
                </button>
              </div>
            </div>
          ))}
          {webhooks.length === 0 && <p className="py-2 text-sm text-neutral-400">{t('account.noWebhooks')}</p>}
        </div>
      </section>

      {/* API tokens */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('account.apiTokens')}</h2>
        <p className="text-sm text-neutral-500">{t('account.apiTokensHint')}</p>

        {newToken && (
          <div className="rounded border border-emerald-400/40 bg-emerald-500/5 p-3">
            <p className="mb-2 text-sm font-medium text-emerald-300">{t('account.apiTokenOnce')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1 font-mono text-xs text-zinc-100">{newToken}</code>
              <button
                className="btn-ghost px-2 py-1 text-xs"
                onClick={async () => {
                  await navigator.clipboard?.writeText(newToken).catch(() => {});
                  toast(t('account.quickLinkCopied'), 'success');
                }}
              >
                {t('account.quickCopyLink')}
              </button>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setNewToken(null)}>
                {t('account.apiTokenDismiss')}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <input
            className="input max-w-[12rem]"
            placeholder={t('account.apiTokenName')}
            value={nt.name}
            onChange={(e) => setNt({ ...nt, name: e.target.value })}
          />
          <Select
            className="w-[12rem]"
            value={nt.scopes.join(',')}
            onChange={(v) => setNt({ ...nt, scopes: v.split(',') as ('read' | 'write')[] })}
            options={[
              { value: 'write', label: t('account.apiScopeWrite') },
              { value: 'read', label: t('account.apiScopeRead') },
              { value: 'read,write', label: t('account.apiScopeBoth') },
            ]}
          />
          <Select
            className="w-[13rem]"
            value={nt.folderId}
            onChange={(v) => setNt({ ...nt, folderId: v })}
            options={[{ value: '', label: t('account.apiTokenAnyFolder') }, ...folderOptions]}
          />
          <input
            className="input max-w-[8rem]"
            type="number"
            min={1}
            placeholder={t('account.apiTokenExpiry')}
            value={nt.expiresInDays}
            onChange={(e) => setNt({ ...nt, expiresInDays: e.target.value })}
          />
          <button
            className="btn-primary"
            disabled={!nt.name.trim()}
            onClick={() =>
              wrap(async () => {
                const res = await api.post<{ token: string }>('/account/api-tokens', {
                  name: nt.name.trim(),
                  scopes: nt.scopes,
                  folderId: nt.folderId || null,
                  expiresInDays: Number(nt.expiresInDays) || null,
                });
                setNewToken(res.token);
                setNt({ name: '', scopes: ['write'], folderId: '', expiresInDays: '' });
                await load();
              })
            }
          >
            {t('account.apiTokenCreate')}
          </button>
        </div>

        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {tokens.map((tk) => (
            <div key={tk.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-zinc-200">{tk.name}</span>{' '}
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">{tk.prefix}…</code>{' '}
                <span className="text-xs text-neutral-400">
                  {tk.scopes.join(', ')}
                  {tk.expiresAt ? ` · ${t('account.apiTokenExpires', { date: new Date(tk.expiresAt).toLocaleDateString() })}` : ''}
                  {tk.lastUsedAt ? ` · ${t('account.apiTokenLastUsed', { date: new Date(tk.lastUsedAt).toLocaleDateString() })}` : ` · ${t('account.apiTokenNeverUsed')}`}
                </span>
              </div>
              <button className="btn-danger px-2 py-1" onClick={() => wrap(() => api.del(`/account/api-tokens/${tk.id}`).then(load))}>
                {t('account.revoke')}
              </button>
            </div>
          ))}
          {tokens.length === 0 && <p className="py-2 text-sm text-neutral-400">{t('account.noApiTokens')}</p>}
        </div>
      </section>

      {/* WebDAV */}
      <section className="card space-y-2">
        <h2 className="font-semibold">{t('account.webdav')}</h2>
        <p className="text-sm text-neutral-500">{t('account.webdavHint')}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-black/20 px-2 py-1 font-mono text-xs text-zinc-200">{`${API_URL}/dav/`}</code>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            onClick={async () => {
              await navigator.clipboard?.writeText(`${API_URL}/dav/`).catch(() => {});
              toast(t('account.quickLinkCopied'), 'success');
            }}
          >
            {t('account.quickCopyLink')}
          </button>
        </div>
        <p className="text-xs text-neutral-400">{t('account.webdavCreds')}</p>
      </section>

      {/* Inactivity auto-delete */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('account.autoDeleteTitle')}</h2>
        <p className="text-sm text-neutral-500">{t('account.autoDeleteHint')}</p>
        <Select
          className="w-[16rem]"
          value={autoDelete === null ? '' : String(autoDelete)}
          onChange={(v) =>
            wrap(async () => {
              const days = v === '' ? null : Number(v);
              const res = await api.patch<{ autoDeleteAfterDays: number | null }>('/account/auto-delete', { autoDeleteAfterDays: days });
              setAutoDelete(res.autoDeleteAfterDays);
              toast(t('account.saved'), 'success');
            })
          }
          options={[
            { value: '', label: t('account.autoDeleteNever') },
            { value: '30', label: t('account.autoDelete1m') },
            { value: '90', label: t('account.autoDelete3m') },
            { value: '180', label: t('account.autoDelete6m') },
            { value: '365', label: t('account.autoDelete1y') },
          ]}
        />
        {autoDelete !== null && <p className="text-xs text-amber-300">⚠️ {t('account.autoDeleteActive', { days: autoDelete })}</p>}
      </section>

      {/* Data & privacy (GDPR) */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('account.yourData')}</h2>
        <p className="text-sm text-neutral-500">
          {t('account.dataHint')}
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={`${API_URL}/account/export`}>
            {t('account.exportData')}
          </a>
          <button className="btn-danger" onClick={wipeSpaces}>
            {t('account.wipeSpaces')}
          </button>
          <button className="btn-danger" onClick={deleteAccount}>
            {t('account.deleteAccount')}
          </button>
        </div>
      </section>
    </div>
  );
}
