'use client';

// Zero-Knowledge vaults are now "secured spaces" inside Mes Espaces.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function VaultRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/drive');
  }, [router]);
  return <div className="grid min-h-[40vh] place-items-center text-sm text-zinc-500">Redirection…</div>;
}
