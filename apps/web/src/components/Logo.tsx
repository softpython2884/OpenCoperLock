import { Lock } from 'lucide-react';

/** Brand mark: a violet gradient square with a white padlock, used in the sidebar/headers. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-glow"
      style={{ width: size, height: size }}
    >
      <Lock size={Math.round(size * 0.5)} strokeWidth={2.4} />
    </span>
  );
}
