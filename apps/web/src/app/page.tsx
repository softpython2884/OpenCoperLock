'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/drive' : '/login');
  }, [user, loading, router]);

  return (
    <div className="grid min-h-screen place-items-center text-sm text-neutral-500">Loading…</div>
  );
}
