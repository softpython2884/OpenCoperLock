'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublicQuickCode, PublicUser } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

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
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [codes, setCodes] = useState<PublicQuickCode[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [cap, setCap] = useState('0');
  const [error, setError] = useState<string | null>(null);

  // new-user form
  const [nu, setNu] = useState({ email: '', password: '', role: 'USER' });

  const loadAll = useCallback(async () => {
    const [s, u, c, a, settings] = await Promise.all([
      api.get<Stats>('/admin/stats'),
      api.get<{ users: PublicUser[] }>('/admin/users'),
      api.get<{ codes: PublicQuickCode[] }>('/admin/quick-codes'),
      api.get<{ logs: AuditEntry[] }>('/admin/audit?limit=50'),
      api.get<{ globalStorageCapBytes: number }>('/admin/settings'),
    ]);
    setStats(s);
    setUsers(u.users);
    setCodes(c.codes);
    setAudit(a.logs);
    setCap(String(s.globalCapBytes));
    void settings;
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

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Users" value={String(stats.userCount)} />
          <Stat label="Files" value={String(stats.fileCount)} />
          <Stat label="Storage used" value={formatBytes(stats.globalUsedBytes)} />
          <Stat
            label="Global cap"
            value={stats.globalCapBytes === 0 ? 'Unlimited' : formatBytes(stats.globalCapBytes)}
          />
        </div>
      )}

      {/* Global cap setting */}
      <section className="card space-y-2">
        <h2 className="font-semibold">Global storage cap</h2>
        <p className="text-sm text-neutral-500">Total bytes across all users. 0 = unlimited.</p>
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
            Save
          </button>
        </div>
      </section>

      {/* Users */}
      <section className="card space-y-3">
        <h2 className="font-semibold">Users</h2>
        <div className="flex flex-wrap gap-2">
          <input
            className="input max-w-xs"
            placeholder="email"
            value={nu.email}
            onChange={(e) => setNu({ ...nu, email: e.target.value })}
          />
          <input
            className="input max-w-xs"
            placeholder="password (min 12)"
            type="password"
            value={nu.password}
            onChange={(e) => setNu({ ...nu, password: e.target.value })}
          />
          <select
            className="input max-w-[8rem]"
            value={nu.role}
            onChange={(e) => setNu({ ...nu, role: e.target.value })}
          >
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
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
            Add user
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
                  {u.disabled && ' · disabled'}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  className="btn-ghost px-2 py-1"
                  onClick={() => {
                    const gb = window.prompt('Quota in GiB (empty = unlimited)');
                    if (gb === null) return;
                    const quotaBytes = gb === '' ? null : Math.round(Number(gb) * 1024 ** 3);
                    void wrap(() => api.patch(`/admin/users/${u.id}`, { quotaBytes }));
                  }}
                >
                  Quota
                </button>
                <button
                  className="btn-ghost px-2 py-1"
                  disabled={u.id === user?.id}
                  onClick={() => wrap(() => api.patch(`/admin/users/${u.id}`, { disabled: !u.disabled }))}
                >
                  {u.disabled ? 'Enable' : 'Disable'}
                </button>
                <button
                  className="btn-danger px-2 py-1"
                  disabled={u.id === user?.id}
                  onClick={() => {
                    if (window.confirm(`Delete ${u.email}?`))
                      void wrap(() => api.del(`/admin/users/${u.id}`));
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick codes */}
      <section className="card space-y-3">
        <h2 className="font-semibold">Quick-Upload codes</h2>
        <button
          className="btn-primary"
          onClick={() =>
            wrap(() =>
              api.post('/admin/quick-codes', {
                usageLimit: Number(window.prompt('Usage limit (empty = unlimited)') || '') || null,
              }),
            )
          }
        >
          Generate code
        </button>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {codes.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div>
                <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono dark:bg-neutral-800">
                  {c.code}
                </code>{' '}
                <span className="text-xs text-neutral-400">
                  used {c.usageCount}
                  {c.usageLimit !== null && `/${c.usageLimit}`}
                </span>
              </div>
              <button className="btn-danger px-2 py-1" onClick={() => wrap(() => api.del(`/admin/quick-codes/${c.id}`))}>
                Revoke
              </button>
            </div>
          ))}
          {codes.length === 0 && <p className="py-2 text-sm text-neutral-400">No active codes.</p>}
        </div>
      </section>

      {/* Audit */}
      <section className="card space-y-2">
        <h2 className="font-semibold">Audit log</h2>
        <div className="max-h-72 overflow-auto text-xs">
          {audit.map((a) => (
            <div key={a.id} className="flex justify-between gap-2 border-b border-neutral-100 py-1 dark:border-neutral-800">
              <span className="font-mono">{a.action}</span>
              <span className="text-neutral-400">
                {a.actorEmail ?? 'guest'} · {a.ip} · {new Date(a.createdAt).toLocaleString()}
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
