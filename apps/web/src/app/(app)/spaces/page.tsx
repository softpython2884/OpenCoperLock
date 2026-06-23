'use client';

/**
 * "Espaces Partagés" — collaborative areas. Each space is owned by one user (who pays for the
 * storage) and shared with a group of members as EDITOR or VIEWER. Content is always server-side
 * encrypted (never Zero-Knowledge, which can't be shared). This page lists the spaces you own or
 * belong to and lets you create new ones; opening one goes to /spaces/[id].
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Plus, Crown, ChevronRight } from 'lucide-react';
import type { PublicSpace } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { prompt, toast } from '@/components/ui/overlays';

function roleLabelKey(role: PublicSpace['myRole']): string {
  return role === 'OWNER' ? 'space.roleOwner' : role === 'EDITOR' ? 'space.roleEditor' : 'space.roleViewer';
}

export default function SpacesPage() {
  const { t } = useT();
  const [spaces, setSpaces] = useState<PublicSpace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api.get<{ spaces: PublicSpace[] }>('/spaces');
    setSpaces(res.spaces);
  }, []);

  useEffect(() => {
    void load()
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [load]);

  async function create() {
    const name = await prompt({ title: t('space.createTitle'), label: t('space.nameLabel'), placeholder: t('space.namePlaceholder'), confirmLabel: t('space.create') });
    if (!name?.trim()) return;
    try {
      await api.post('/spaces', { name: name.trim() });
      await load();
      toast(t('space.created'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.createFailed'), 'error');
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t('nav.sharedSpaces')}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t('space.subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={create}>
          <Plus size={16} /> {t('space.new')}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</div>}

      {loading ? (
        <p className="text-sm text-zinc-500">{t('common.loading')}</p>
      ) : spaces.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.04] text-zinc-500">
            <Users size={26} />
          </span>
          <div>
            <p className="font-medium text-zinc-200">{t('space.empty')}</p>
            <p className="mt-1 text-sm text-zinc-500">{t('space.emptyHint')}</p>
          </div>
          <button className="btn-ghost mt-1" onClick={create}>
            <Plus size={15} /> {t('space.new')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {spaces.map((s) => (
            <Link key={s.id} href={`/spaces/${s.id}`} className="row flex-wrap transition hover:border-white/15">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-violet-300">
                  <Users size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">{s.name}</p>
                  <p className="text-xs text-zinc-500">
                    {t(roleLabelKey(s.myRole))}
                    {s.myRole !== 'OWNER' && ` · ${t('space.ownedBy', { email: s.ownerEmail })}`}
                    {' · '}
                    {s.memberCount > 1 ? t('space.membersCount', { count: s.memberCount }) : t('space.memberCount', { count: s.memberCount })}
                    {' · '}
                    {formatBytes(s.usedBytes)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-zinc-500">
                {s.myRole === 'OWNER' && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                    <Crown size={12} /> {t('space.roleOwner')}
                  </span>
                )}
                <ChevronRight size={18} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
