'use client';

// Zero-Knowledge vaults are now "secured spaces" inside Mes Espaces.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';

export default function VaultRedirect() {
  const router = useRouter();
  const { t } = useT();
  useEffect(() => {
    router.replace('/drive');
  }, [router]);
  return <div className="grid min-h-[40vh] place-items-center text-sm text-zinc-500">{t('redirect.loading')}</div>;
}
