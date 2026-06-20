'use client';

/**
 * In-app replacements for the browser's native `alert` / `confirm` / `prompt`, plus toasts.
 *
 * Everything is driven by a tiny module-level store so the helpers can be called from
 * anywhere — including plain async functions — without threading React context through every
 * call site:
 *
 *   if (await confirm({ title: 'Delete?', danger: true })) …
 *   const name = await prompt({ title: 'Rename', defaultValue: f.name });
 *   const mode = await choose({ title: 'Access', options: [...] });
 *   toast('Saved', 'success');
 *
 * Mount <Overlays /> once near the app root for these to render.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Info, X } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────--

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface PromptOpts {
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  password?: boolean;
}
export interface ChooseOption<T = string> {
  value: T;
  label: string;
  description?: string;
}
interface ChooseOpts<T = string> {
  title: string;
  message?: string;
  options: ChooseOption<T>[];
}

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'choose'; opts: ChooseOpts<unknown>; resolve: (v: unknown) => void };

// ── Store ──────────────────────────────────────────────────────────────────--

let dialog: DialogState | null = null;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextToastId = 1;

function emit() {
  for (const l of listeners) l();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function openDialog(state: DialogState) {
  dialog = state;
  emit();
}
function closeDialog() {
  dialog = null;
  emit();
}

// ── Public API ─────────────────────────────────────────────────────────────--

export function confirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => openDialog({ kind: 'confirm', opts, resolve }));
}
export function prompt(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => openDialog({ kind: 'prompt', opts, resolve }));
}
export function choose<T = string>(opts: ChooseOpts<T>): Promise<T | null> {
  return new Promise((resolve) =>
    openDialog({ kind: 'choose', opts: opts as ChooseOpts<unknown>, resolve: resolve as (v: unknown) => void }),
  );
}
export function toast(message: string, kind: ToastKind = 'info') {
  const t: Toast = { id: nextToastId++, kind, message };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, 4200);
}

// ── Host component ─────────────────────────────────────────────────────────--

export function Overlays() {
  const [, force] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return subscribe(() => force((n) => n + 1));
  }, []);
  if (!mounted) return null;

  return createPortal(
    <>
      {dialog && <DialogHost state={dialog} onClose={closeDialog} />}
      <ToastStack toasts={toasts} />
    </>,
    document.body,
  );
}

function Shell({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-ink-850 p-5 shadow-glow"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHost({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const [value, setValue] = useState(state.kind === 'prompt' ? (state.opts.defaultValue ?? '') : '');

  function finish(result: boolean | string | null | unknown) {
    onClose();
    state.resolve(result as never);
  }

  if (state.kind === 'confirm') {
    const o = state.opts;
    return (
      <Shell onCancel={() => finish(false)}>
        <div className="flex items-start gap-3">
          {o.danger && (
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-400">
              <AlertTriangle size={18} />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-semibold text-zinc-100">{o.title}</h3>
            {o.message && <p className="mt-1 whitespace-pre-line text-sm text-zinc-400">{o.message}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => finish(false)}>
            {o.cancelLabel ?? 'Annuler'}
          </button>
          <button className={o.danger ? 'btn-danger' : 'btn-primary'} onClick={() => finish(true)} autoFocus>
            {o.confirmLabel ?? 'Confirmer'}
          </button>
        </div>
      </Shell>
    );
  }

  if (state.kind === 'prompt') {
    const o = state.opts;
    return (
      <Shell onCancel={() => finish(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            finish(value.trim() === '' ? null : value);
          }}
        >
          <h3 className="font-semibold text-zinc-100">{o.title}</h3>
          {o.message && <p className="mt-1 text-sm text-zinc-400">{o.message}</p>}
          {o.label && <label className="label mt-3">{o.label}</label>}
          <input
            className={`input ${o.label ? '' : 'mt-3'}`}
            type={o.password ? 'password' : 'text'}
            placeholder={o.placeholder}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => finish(null)}>
              Annuler
            </button>
            <button type="submit" className="btn-primary">
              {o.confirmLabel ?? 'Valider'}
            </button>
          </div>
        </form>
      </Shell>
    );
  }

  // choose
  const o = state.opts;
  return (
    <Shell onCancel={() => finish(null)}>
      <h3 className="font-semibold text-zinc-100">{o.title}</h3>
      {o.message && <p className="mt-1 text-sm text-zinc-400">{o.message}</p>}
      <div className="mt-4 space-y-2">
        {o.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => finish(opt.value)}
            className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-accent/40 hover:bg-white/[0.05]"
          >
            <div className="min-w-0">
              <p className="font-medium text-zinc-100">{opt.label}</p>
              {opt.description && <p className="text-xs text-zinc-500">{opt.description}</p>}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end">
        <button className="btn-ghost" onClick={() => finish(null)}>
          Annuler
        </button>
      </div>
    </Shell>
  );
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[110] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? Check : t.kind === 'error' ? X : Info;
        const tint =
          t.kind === 'success'
            ? 'text-emerald-400'
            : t.kind === 'error'
              ? 'text-red-400'
              : 'text-violet-300';
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-white/10 bg-ink-850/95 px-4 py-3 shadow-glow backdrop-blur"
          >
            <span className={`mt-0.5 shrink-0 ${tint}`}>
              <Icon size={17} />
            </span>
            <p className="text-sm text-zinc-200">{t.message}</p>
          </div>
        );
      })}
    </div>
  );
}
