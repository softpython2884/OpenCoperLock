import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { OfflineProvider } from '@/lib/offline';
import { I18nProvider } from '@/lib/i18n';
import { Overlays } from '@/components/ui/overlays';
import { PwaRegister } from '@/components/PwaRegister';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://copper.forgenet.fr';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'OpenCoperLock',
    template: '%s · OpenCoperLock',
  },
  description:
    'Cloud privé auto-hébergeable : espaces chiffrés, coffres Zero-Knowledge, partage et outils de sécurité.',
  applicationName: 'OpenCoperLock',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    title: 'OpenCoperLock',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    type: 'website',
    siteName: 'OpenCoperLock',
    title: 'OpenCoperLock — votre cloud privé',
    description:
      'Espaces chiffrés, coffres Zero-Knowledge, partage sécurisé et Quick-Upload. Auto-hébergé, open-source (AGPLv3).',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OpenCoperLock — votre cloud privé',
    description: 'Espaces chiffrés, coffres Zero-Knowledge et partage sécurisé. Open-source, auto-hébergé.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <body className="min-h-screen font-sans">
        <I18nProvider>
          <AuthProvider>
            <OfflineProvider>{children}</OfflineProvider>
          </AuthProvider>
          <Overlays />
        </I18nProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
