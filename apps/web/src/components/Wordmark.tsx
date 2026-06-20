/**
 * Stylised brand wordmark. "Open" in muted zinc, "Coper" in white, "Lock" in the violet
 * accent with a soft glow — distinctive without a separate logo glyph beside it.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`select-none text-lg font-semibold tracking-tight ${className}`}>
      <span className="text-zinc-400">Open</span>
      <span className="text-white">Coper</span>
      <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent [text-shadow:0_0_18px_rgba(139,92,246,0.35)]">
        Lock
      </span>
    </span>
  );
}
