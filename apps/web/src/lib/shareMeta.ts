/**
 * Server-side helper to fetch a share's public metadata, used by `generateMetadata` and the
 * dynamic Open Graph image so social platforms (Discord, Slack, X, …) get a rich preview.
 *
 * The API only returns the file name / entries once access is granted, so code- and
 * sign-in-protected shares never leak their contents into link previews.
 */
import type { PublicShareView, ShareItemKind } from '@opencoperlock/shared/client';

export const SHARE_API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function fetchShareView(token: string): Promise<PublicShareView | null> {
  try {
    const res = await fetch(`${SHARE_API_ORIGIN}/s/${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PublicShareView;
  } catch {
    return null;
  }
}

/** Direct, credential-free URL to a shared file's bytes (used as an OG image for public images). */
export function shareInlineUrl(token: string, fileId: string): string {
  return `${SHARE_API_ORIGIN}/s/${encodeURIComponent(token)}/file/${encodeURIComponent(fileId)}?inline=1`;
}

const KIND_LABELS: Record<ShareItemKind, string> = {
  image: 'Image',
  pdf: 'PDF',
  audio: 'Audio',
  video: 'Vidéo',
  text: 'Document texte',
  other: 'Fichier',
};

export function kindLabel(kind: ShareItemKind): string {
  return KIND_LABELS[kind] ?? 'Fichier';
}
