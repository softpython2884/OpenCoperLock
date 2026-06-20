import { ImageResponse } from 'next/og';
import { fetchShareView, kindLabel } from '@/lib/shareMeta';

// Branded Open Graph card for a share link (folders + non-image files; public images use the
// image itself, set in generateMetadata). 1200×630 PNG.
export const runtime = 'edge';
export const alt = 'Partage OpenCoperLock';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function ShareOgImage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await fetchShareView(token);

  let heading = 'Partage';
  let title = 'Fichier partagé';
  let subtitle = 'Partagé via OpenCoperLock';

  if (!view || view.expired) {
    heading = 'Lien de partage';
    title = 'Lien indisponible';
    subtitle = 'Ce lien est invalide ou a expiré';
  } else if (view.requiresCode || view.requiresAuth) {
    heading = 'Partage protégé';
    title = view.requiresAuth ? 'Réservé aux comptes' : 'Protégé par un code';
    subtitle = 'Ouvrez le lien pour y accéder';
  } else if (view.file) {
    heading = kindLabel(view.file.kind);
    title = view.file.name;
    subtitle = 'Partagé via OpenCoperLock';
  } else if (view.entries) {
    const n = view.entries.length;
    heading = 'Dossier partagé';
    title = `${n} fichier${n > 1 ? 's' : ''}`;
    subtitle = 'Partagé via OpenCoperLock';
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: '#0a0a0f',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>
          <span style={{ color: '#71717a' }}>Open</span>
          <span style={{ color: 'white' }}>Coper</span>
          <span style={{ color: '#a78bfa' }}>Lock</span>
        </div>

        {/* Main */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              alignSelf: 'flex-start',
              fontSize: 22,
              color: '#a78bfa',
              border: '1px solid rgba(167,139,250,0.4)',
              borderRadius: 8,
              padding: '6px 14px',
              marginBottom: 24,
            }}
          >
            {heading}
          </div>
          <div
            style={{
              fontSize: 60,
              fontWeight: 700,
              letterSpacing: -1,
              lineHeight: 1.1,
              maxWidth: 1000,
              overflow: 'hidden',
            }}
          >
            {title.length > 70 ? `${title.slice(0, 70)}…` : title}
          </div>
          <div style={{ marginTop: 20, fontSize: 28, color: '#a1a1aa' }}>{subtitle}</div>
        </div>

        {/* Footer */}
        <div style={{ fontSize: 22, color: '#52525b' }}>copper.forgenet.fr · par Forge Network</div>
      </div>
    ),
    size,
  );
}
