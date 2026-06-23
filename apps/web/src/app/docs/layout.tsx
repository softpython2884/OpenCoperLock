import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Documentation complète d’OpenCoperLock : espaces & coffres, fichiers, partage, Quick-Upload, API REST, webhooks, WebDAV, sécurité.',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
