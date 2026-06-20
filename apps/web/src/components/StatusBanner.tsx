'use client';

/**
 * Polls /status and shows degraded-component warnings (DB, storage, antivirus). Each
 * warning is dismissible — the dismissal is remembered in localStorage, so e.g. a user who
 * doesn't run an antivirus can hide the "scanner offline" notice for good. A genuinely new
 * warning (different text) will still appear.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { api } from '@/lib/api';

interface Status {
  ready: boolean;
  warnings: string[];
}

const STORE_KEY = 'ocl_dismissed_notices';

function loadDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function StatusBanner() {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    setDismissed(loadDismissed());
    let active = true;
    const load = async () => {
      try {
        const res = await api.get<Status>('/status');
        if (active) setWarnings(res.warnings);
      } catch {
        /* not signed in / unreachable — stay quiet */
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const dismiss = useCallback((w: string) => {
    setDismissed((prev) => {
      const next = [...new Set([...prev, w])];
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const visible = warnings.filter((w) => !dismissed.includes(w));
  if (visible.length === 0) return null;

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/[0.06]">
      <div className="mx-auto max-w-5xl space-y-1 px-8 py-2.5">
        {visible.map((w) => (
          <div key={w} className="flex items-center justify-between gap-3 text-sm text-amber-200/90">
            <span className="flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0 text-amber-400" />
              {w}
            </span>
            <button
              title="Masquer"
              onClick={() => dismiss(w)}
              className="shrink-0 rounded-md p-1 text-amber-300/70 transition hover:bg-amber-500/10 hover:text-amber-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
