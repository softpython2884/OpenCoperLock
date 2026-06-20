import { ImageResponse } from 'next/og';

// Social/link-preview card (Discord, Slack, X, …). Rendered to a 1200×630 PNG by Next.
export const runtime = 'edge';
export const alt = 'OpenCoperLock — votre cloud privé';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'radial-gradient(1000px 700px at 100% -10%, rgba(139,92,246,0.35), transparent 60%), #0a0a0f',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #8b5cf6, #c026d3)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 34,
                marginTop: 10,
                borderRadius: 8,
                border: '6px solid white',
                borderTop: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>
            <span style={{ color: '#a1a1aa' }}>Open</span>
            <span style={{ color: 'white' }}>Coper</span>
            <span style={{ color: '#c4b5fd' }}>Lock</span>
          </div>
        </div>
        <div style={{ marginTop: 40, fontSize: 40, lineHeight: 1.25, color: '#d4d4d8', maxWidth: 900 }}>
          Votre cloud privé : espaces chiffrés, coffres Zero-Knowledge et partage sécurisé.
        </div>
        <div style={{ marginTop: 36, fontSize: 26, color: '#8b5cf6' }}>
          Open-source · Auto-hébergé · par Forge Network
        </div>
      </div>
    ),
    size,
  );
}
