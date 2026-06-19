/** Shared helpers for share links, used by both the API and the recipient page. */
import type { ShareItemKind } from './types.js';

/** Classify a MIME type into a coarse kind that drives the preview UI. */
export function mimeKind(mime: string): ShareItemKind {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/pdf') return 'pdf';
  if (
    m.startsWith('text/') ||
    m === 'application/json' ||
    m === 'application/xml' ||
    m === 'application/javascript'
  ) {
    return 'text';
  }
  return 'other';
}
