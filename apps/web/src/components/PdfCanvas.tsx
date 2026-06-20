'use client';

/**
 * Renders a PDF to <canvas> using pdf.js. Unlike an <iframe>, this works on mobile browsers
 * (which have no built-in inline PDF viewer for frames) and sidesteps CSP entirely — nothing
 * is framed, the worker is bundled same-origin. Falls back via `onFail` if anything throws.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

export function PdfCanvas({ blob, onFail }: { blob: Blob; onFail?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let destroy: () => void = () => {};

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Bundled, same-origin worker (CSP-safe: worker-src falls back to script-src 'self').
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        const buf = await blob.arrayBuffer();
        if (cancelled) return;
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        destroy = () => {
          void doc.destroy();
        };

        const container = containerRef.current;
        if (!container || cancelled) return;
        container.replaceChildren();

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const maxPages = Math.min(doc.numPages, 50);
        const cssWidth = Math.min(container.clientWidth || 800, 900);

        for (let n = 1; n <= maxPages; n += 1) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const unit = page.getViewport({ scale: 1 });
          const scale = cssWidth / unit.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.marginBottom = '12px';
          canvas.style.borderRadius = '8px';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          await page.render({ canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          container.appendChild(canvas);
          if (n === 1) setLoading(false);
        }
        setLoading(false);
      } catch {
        if (!cancelled) onFail?.();
      }
    })();

    return () => {
      cancelled = true;
      destroy();
    };
  }, [blob, onFail]);

  return (
    <div className="h-full w-full overflow-auto">
      {loading && (
        <div className="grid h-full place-items-center">
          <Loader2 className="animate-spin text-zinc-500" size={28} />
        </div>
      )}
      <div ref={containerRef} className="mx-auto flex w-full max-w-3xl flex-col items-center" />
    </div>
  );
}
