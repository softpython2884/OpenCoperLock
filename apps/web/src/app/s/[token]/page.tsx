import type { Metadata } from 'next';
import { formatBytes } from '@opencoperlock/shared/client';
import { fetchShareView, kindLabel, shareInlineUrl } from '@/lib/shareMeta';
import ShareClient from './ShareClient';

/**
 * Server wrapper for a share link. It exists so we can emit per-link Open Graph metadata —
 * a rich preview card (and, for public images, the image itself) when the link is pasted
 * into Discord/Slack/X — while the interactive recipient UI stays a client component.
 *
 * Share links are always `noindex`: previews are fine, search-engine indexing is not.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const view = await fetchShareView(token);

  const base: Metadata = { robots: { index: false, follow: false } };

  if (!view || view.expired) {
    return { ...base, title: 'Lien de partage', description: 'Ce lien de partage est invalide ou a expiré.' };
  }

  // Protected links never reveal their contents in a preview.
  if (view.requiresCode || view.requiresAuth) {
    const why = view.requiresAuth ? 'réservé aux comptes' : 'protégé par un code';
    return {
      ...base,
      title: 'Partage protégé',
      description: `Ce lien est ${why}. Ouvrez-le pour y accéder.`,
      openGraph: {
        title: 'Partage protégé · OpenCoperLock',
        description: `Ce lien est ${why}.`,
      },
    };
  }

  // Single file.
  if (view.file) {
    const f = view.file;
    const desc = `${kindLabel(f.kind)} · ${formatBytes(f.sizeBytes)} — partagé via OpenCoperLock`;
    // For a public image, the image itself makes the best preview; otherwise a branded card.
    const images = f.kind === 'image' ? [shareInlineUrl(token, f.fileId)] : [`/s/${token}/opengraph-image`];
    return {
      ...base,
      title: f.name,
      description: desc,
      openGraph: { title: f.name, description: desc, images },
      twitter: { card: 'summary_large_image', title: f.name, description: desc, images },
    };
  }

  // Folder.
  const n = view.entries?.length ?? 0;
  const title = `Dossier partagé (${n} fichier${n > 1 ? 's' : ''})`;
  return {
    ...base,
    title,
    description: `${n} fichier${n > 1 ? 's' : ''} partagé${n > 1 ? 's' : ''} via OpenCoperLock.`,
    openGraph: { title, description: `Partagé via OpenCoperLock.`, images: [`/s/${token}/opengraph-image`] },
    twitter: { card: 'summary_large_image', title, images: [`/s/${token}/opengraph-image`] },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareClient token={token} />;
}
