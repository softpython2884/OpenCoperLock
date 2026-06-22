'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicQuickCode, PublicUser } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { confirm, prompt } from '@/components/ui/overlays';
import { UpdatePanel } from './UpdatePanel';

interface Stats {
  globalUsedBytes: number;
  globalCapBytes: number;
  userCount: number;
  fileCount: number;
}
interface AuditEntry {
  id: string;
  action: string;
  target: string | null;
  ip: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const { user } = useAuth();
  const { t } = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [codes, setCodes] = useState<PublicQuickCode[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [cap, setCap] = useState('0');
  const [vtConfigured, setVtConfigured] = useState(false);
  const [vtKey, setVtKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  // new-user form
  const [nu, setNu] = useState({ email: '', password: '', role: 'USER' });
  // new quick-code form (optional memorable code)
  const [nc, setNc] = useState({ code: '', usageLimit: '' });

  const [alerts, setAlerts] = useState<string[]>([]);

  const loadAll = useCallback(async () => {
    const [s, u, c, a, settings, al] = await Promise.all([
      api.get<Stats>('/admin/stats'),
      api.get<{ users: PublicUser[] }>('/admin/users'),
      api.get<{ codes: PublicQuickCode[] }>('/admin/quick-codes'),
      api.get<{ logs: AuditEntry[] }>('/admin/audit?limit=50'),
      api.get<{ globalStorageCapBytes: number; virustotalConfigured: boolean }>('/admin/settings'),
      api.get<{ warnings: string[] }>('/admin/alerts'),
    ]);
    setStats(s);
    setUsers(u.users);
    setCodes(c.codes);
    setAudit(a.logs);
    setCap(String(s.globalCapBytes));
    setAlerts(al.warnings);
    setVtConfigured(settings.virustotalConfigured);
  }, []);

  useEffect(() => {
    void loadAll().catch((e) => setError(String(e)));
  }, [loadAll]);

  async function wrap(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {alerts.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="mb-1 text-sm font-medium text-amber-800 dark:text-amber-200">{t('admin.alerts')}</p>
          <ul className="list-inside list-disc text-sm text-amber-800 dark:text-amber-200">
            {alerts.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('admin.statUsers')} value={String(stats.userCount)} />
          <Stat label={t('admin.statFiles')} value={String(stats.fileCount)} />
          <Stat label={t('admin.statStorageUsed')} value={formatBytes(stats.globalUsedBytes)} />
          <Stat
            label={t('admin.statGlobalCap')}
            value={stats.globalCapBytes === 0 ? t('admin.unlimited') : formatBytes(stats.globalCapBytes)}
          />
        </div>
      )}

      {/* Version & updates */}
      <UpdatePanel />

      {/* Global cap setting */}
      <section className="card space-y-2">
        <h2 className="font-semibold">{t('admin.globalCapTitle')}</h2>
        <p className="text-sm text-neutral-500">{t('admin.globalCapHint')}</p>
        <div className="flex gap-2">
          <input className="input" value={cap} onChange={(e) => setCap(e.target.value)} />
          <button
            className="btn-primary whitespace-nowrap"
            onClick={() =>
              wrap(() =>
                api.patch('/admin/settings', { globalStorageCapBytes: Number(cap) || 0 }),
              )
            }
          >
            {t('admin.save')}
          </button>
        </div>
      </section>

      {/* VirusTotal */}
      <section className="card space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('admin.vtTitle')}</h2>
          <span className={`chip ${vtConfigured ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[0.05] text-zinc-400'}`}>
            {vtConfigured ? t('admin.vtActive') : t('admin.vtInactive')}
          </span>
        </div>
        <p className="text-sm text-neutral-500">{t('admin.vtHint')}</p>
        <div className="flex gap-2">
          <input
            className="input font-mono"
            type="password"
            placeholder={vtConfigured ? t('admin.vtPlaceholderSet') : t('admin.vtPlaceholder')}
            value={vtKey}
            onChange={(e) => setVtKey(e.target.value)}
          />
          <button
            className="btn-primary whitespace-nowrap"
            onClick={() =>
              wrap(async () => {
                const res = await api.patch<{ virustotalConfigured: boolean }>('/admin/settings', { virustotalApiKey: vtKey.trim() });
                setVtConfigured(res.virustotalConfigured);
                setVtKey('');
              })
            }
          >
            {t('admin.save')}
          </button>
        </div>
        {vtConfigured && (
          <button
            className="text-xs text-red-300 hover:underline"
            onClick={() =>
              wrap(async () => {
                const res = await api.patch<{ virustotalConfigured: boolean }>('/admin/settings', { virustotalApiKey: '' });
                setVtConfigured(res.virustotalConfigured);
                setVtKey('');
              })
            }
          >
            {t('admin.vtClear')}
          </button>
        )}
      </section>

      {/* Users */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('admin.users')}</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs"
            placeholder={t('admin.emailPlaceholder')}
            value={nu.email}
            onChange={(e) => setNu({ ...nu, email: e.target.value })}
          />
          <input
            className="input max-w-xs"
            placeholder={t('admin.passwordPlaceholder')}
            type="password"
            value={nu.password}
            onChange={(e) => setNu({ ...nu, password: e.target.value })}
          />
          <select
            className="input max-w-[8rem]"
            value={nu.role}
            onChange={(e) => setNu({ ...nu, role: e.target.value })}
          >
            <option value="USER">{t('admin.roleUser')}</option>
            <option value="ADMIN">{t('admin.roleAdmin')}</option>
          </select>
          <button
            className="btn-primary"
            onClick={() =>
              wrap(async () => {
                await api.post('/admin/users', nu);
                setNu({ email: '', password: '', role: 'USER' });
              })
            }
          >
            {t('admin.addUser')}
          </button>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <span className="font-medium">{u.email}</span>{' '}
                <span className="text-xs text-neutral-400">
                  {u.role} · {formatBytes(u.usedBytes)}
                  {u.quotaBytes !== null && ` / ${formatBytes(u.quotaBytes)}`}
                  {u.disabled && ` · ${t('admin.disabled')}`}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={async () => {
                    const gb = await prompt({
                      title: t('admin.quotaTitle'),
                      label: t('admin.quotaLabel'),
                      defaultValue: u.quotaBytes !== null ? String(Math.round(u.quotaBytes / 1024 ** 3)) : '',
                    });
                    if (gb === null) return;
                    const quotaBytes = gb.trim() === '' ? null : Math.round(Number(gb) * 1024 ** 3);
                    void wrap(() => api.patch(`/admin/users/${u.id}`, { quotaBytes }));
                  }}
                >
                  {t('admin.quota')}
                </button>
                <button
                  className="btn-ghost px-2 py-1"
                  disabled={u.id === user?.id}
                  onClick={() => wrap(() => api.patch(`/admin/users/${u.id}`, { disabled: !u.disabled }))}
                >
                  {u.disabled ? t('admin.enable') : t('admin.disable')}
                </button>
                <button
                  className="btn-danger px-2 py-1"
                  disabled={u.id === user?.id}
                  onClick={async () => {
                    if (await confirm({ title: t('admin.deleteUserTitle', { email: u.email }), danger: true, confirmLabel: t('admin.delete') }))
                      void wrap(() => api.del(`/admin/users/${u.id}`));
                  }}
                >
                  {t('admin.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick codes */}
      <section className="card space-y-3">
        <h2 className="font-semibold">{t('admin.quickCodes')}</h2>
        <p className="text-sm text-neutral-500">
          {t('admin.quickCodesHintPre')}{' '}
          <span className="font-medium text-zinc-300">{t('admin.quickCodesFolder')}</span>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input max-w-xs font-mono uppercase tracking-wide"
            placeholder={t('admin.customCodePlaceholder')}
            value={nc.code}
            onChange={(e) => setNc({ ...nc, code: e.target.value.toUpperCase() })}
          />
          <input
            className="input max-w-[10rem]"
            type="number"
            min={1}
            placeholder={t('admin.usageLimitPlaceholder')}
            value={nc.usageLimit}
            onChange={(e) => setNc({ ...nc, usageLimit: e.target.value })}
          />
          <button
            className="btn-primary"
            onClick={() =>
              wrap(async () => {
                await api.post('/admin/quick-codes', {
                  code: nc.code.trim() || undefined,
                  usageLimit: Number(nc.usageLimit) || null,
                });
                setNc({ code: '', usageLimit: '' });
              })
            }
          >
            {t('admin.createCode')}
          </button>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {codes.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div>
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">
                  {c.code}
                </code>{' '}
                <span className="text-xs text-neutral-400">
                  {c.usageLimit !== null
                    ? t('admin.usedCountLimited', { count: c.usageCount, limit: c.usageLimit })
                    : t('admin.usedCount', { count: c.usageCount })}
                </span>
              </div>
              <button className="btn-danger px-2 py-1" onClick={() => wrap(() => api.del(`/admin/quick-codes/${c.id}`))}>
                {t('admin.revoke')}
              </button>
            </div>
          ))}
          {codes.length === 0 && <p className="py-2 text-sm text-neutral-400">{t('admin.noCodes')}</p>}
        </div>
      </section>

      {/* Audit */}
      <section className="card space-y-2">
        <h2 className="font-semibold">{t('admin.auditLog')}</h2>
        <div className="max-h-72 overflow-auto text-xs">
          {audit.map((a) => (
            <div key={a.id} className="flex justify-between gap-2 border-b border-neutral-100 py-1 dark:border-neutral-800">
              <span className="font-mono">{a.action}</span>
              <span className="text-neutral-400">
                {a.actorEmail ?? t('admin.guest')} · {a.ip} · {new Date(a.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <p className="text-xs uppercase text-neutral-400">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
