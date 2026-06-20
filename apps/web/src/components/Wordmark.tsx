/**
 * Stylised brand wordmark. "Open" in muted zinc, "Coper" in white, "Lock" in a restrained
 * violet — distinctive without a separate logo glyph or glow, to keep the sober look.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`select-none text-lg font-semibold tracking-tight ${className}`}>
      <span className="text-zinc-500">Open</span>
      <span className="text-white">Coper</span>
      <span className="text-violet-400">Lock</span>
    </span>
  );
}
