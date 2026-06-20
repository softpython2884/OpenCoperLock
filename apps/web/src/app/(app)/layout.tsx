'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FolderLock, Share2, Globe, Settings, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Logo } from '@/components/Logo';
import { StatusBanner } from '@/components/StatusBanner';
import { formatBytes } from '@opencoperlock/shared/client';

const NAV = [
  { href: '/drive', label: 'Mes Espaces', icon: FolderLock },
  { href: '/shares', label: 'Partages', icon: Share2 },
  { href: '/remote', label: 'Remote', icon: Globe },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center text-sm text-zinc-500">Loading…</div>;
  }

  const items = [...NAV];
  if (user.role === 'ADMIN') items.push({ href: '/admin', label: 'Administration', icon: ShieldCheck });

  const quotaPct =
    user.quotaBytes && user.quotaBytes > 0
      ? Math.min(100, Math.round((user.usedBytes / user.quotaBytes) * 100))
      : 0;
  const initials = user.email.slice(0, 2).toUpperCase();

  const NavLink = ({ href, label, icon: Icon }: (typeof items)[number]) => {
    const active = pathname === href || pathname.startsWith(href + '/');
    return (
      <Link
        href={href}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
          active
            ? 'bg-accent-soft text-violet-300'
            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
        }`}
      >
        <Icon size={18} strokeWidth={2} />
        {label}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-white/[0.06] bg-ink-900/70 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 py-5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight text-white">OpenCoperLock</span>
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
            Paramètres
          </Link>
        </nav>

        {/* Storage + user card */}
        <div className="space-y-3 px-3 pb-4">
          <div className="px-2">
            <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
              <span>Stockage</span>
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
                {user.role === 'ADMIN' ? 'Administrateur' : 'Utilisateur'}
              </p>
            </div>
            <button
              title="Se déconnecter"
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
      </aside>

      {/* Main */}
      <div className="ml-64 flex-1">
        <StatusBanner />
        <main className="mx-auto max-w-5xl px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
