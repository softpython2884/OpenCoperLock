'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { formatBytes } from '@opencoperlock/shared/client';

const NAV = [
  { href: '/drive', label: 'Drive' },
  { href: '/vault', label: 'Vault' },
  { href: '/remote', label: 'Remote' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-neutral-500">Loading…</div>
    );
  }

  const items = user.role === 'ADMIN' ? [...NAV, { href: '/admin', label: 'Admin' }] : NAV;
  const quotaLabel =
    user.quotaBytes === null
      ? `${formatBytes(user.usedBytes)} used`
      : `${formatBytes(user.usedBytes)} / ${formatBytes(user.quotaBytes)}`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold">🔐 OpenCoperLock</span>
            <nav className="flex gap-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-sm ${
                    pathname.startsWith(item.href)
                      ? 'bg-neutral-100 font-medium text-accent dark:bg-neutral-800'
                      : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-500 sm:inline">{quotaLabel}</span>
            <span className="text-neutral-400">·</span>
            <span className="text-neutral-500">{user.email}</span>
            <button
              className="btn-ghost px-2 py-1"
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
