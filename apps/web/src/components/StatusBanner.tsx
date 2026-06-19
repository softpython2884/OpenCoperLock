'use client';

/**
 * Polls the authenticated /status endpoint and surfaces any degraded-component warnings
 * (database, storage, antivirus) as a banner, so a signed-in user is told when something
 * needs the operator's attention.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Status {
  ready: boolean;
  warnings: string[];
}

export function StatusBanner() {
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await api.get<Status>('/status');
        if (active) setWarnings(res.warnings);
      } catch {
        /* not signed in yet, or API unreachable — stay quiet */
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  if (warnings.length === 0) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950">
      <div className="mx-auto max-w-5xl px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
        {warnings.map((w, i) => (
          <p key={i}>System notice: {w}</p>
        ))}
      </div>
    </div>
  );
}
