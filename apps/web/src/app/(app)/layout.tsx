'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FolderLock, Share2, Globe, Settings, ShieldCheck, LogOut, Menu, X, Trash2, BookOpen } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { Wordmark } from '@/components/Wordmark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { StatusBanner } from '@/components/StatusBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { formatBytes } from '@opencoperlock/shared/client';

const NAV = [
  { href: '/drive', labelKey: 'nav.spaces', icon: FolderLock },
  { href: '/shares', labelKey: 'nav.shares', icon: Share2 },
  { href: '/remote', labelKey: 'nav.remote', icon: Globe },
  { href: '/trash', labelKey: 'nav.trash', icon: Trash2 },
  { href: '/docs', labelKey: 'nav.docs', icon: BookOpen },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center text-sm text-zinc-500">Loading…</div>;
  }

  const items = [...NAV];
  if (user.role === 'ADMIN') items.push({ href: '/admin', labelKey: 'nav.admin', icon: ShieldCheck });

  const quotaPct =
    user.quotaBytes && user.quotaBytes > 0
      ? Math.min(100, Math.round((user.usedBytes / user.quotaBytes) * 100))
      : 0;
  const initials = user.email.slice(0, 2).toUpperCase();

  const NavLink = ({ href, labelKey, icon: Icon }: (typeof items)[number]) => {
    const active = pathname === href || pathname.startsWith(href + '/');
    return (
      <Link
        href={href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          active ? 'bg-accent-soft text-violet-300' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
        }`}
      >
        <Icon size={18} strokeWidth={2} />
        {t(labelKey)}
      </Link>
    );
  };

  const Sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Wordmark />
        <button
          className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 md:hidden"
          onClick={() => setDrawer(false)}
          aria-label="Fermer le menu"
        >
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {items.map((it) => (
          <NavLink key={it.href} {...it} />
        ))}
        <Link
          href="/account"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
            pathname.startsWith('/account')
              ? 'bg-accent-soft text-violet-300'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
          }`}
        >
          <Settings size={18} strokeWidth={2} />
          {t('nav.settings')}
        </Link>
      </nav>

      <div className="space-y-3 px-3 pb-4">
        <div className="flex justify-end px-2">
          <LanguageSwitcher />
        </div>
        <div className="px-2">
          <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
            <span>{t('nav.storage')}</span>
            <span>
              {formatBytes(user.usedBytes)}
              {user.quotaBytes ? ` / ${formatBytes(user.quotaBytes)}` : ''}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-accent" style={{ width: `${quotaPct}%` }} />
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-xs font-semibold text-violet-200">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100">{user.email}</p>
            <p className="text-[11px] text-zinc-500">
              {user.role === 'ADMIN' ? t('role.admin') : t('role.user')}
            </p>
          </div>
          <button
            title={t('common.signout')}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-white/[0.06] bg-ink-900/70 backdrop-blur-xl md:block">
        {Sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-white/[0.06] bg-ink-900">
            {Sidebar}
          </aside>
        </div>
      )}

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/[0.06] bg-ink-900/80 px-4 py-3 backdrop-blur-xl md:hidden">
        <button
          className="rounded-lg p-1.5 text-zinc-300 hover:bg-white/5"
          onClick={() => setDrawer(true)}
          aria-label="Ouvrir le menu"
        >
          <Menu size={20} />
        </button>
        <Wordmark className="!text-base" />
      </header>

      {/* Main */}
      <div className="md:ml-64">
        <OfflineBanner />
        <StatusBanner />
        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
