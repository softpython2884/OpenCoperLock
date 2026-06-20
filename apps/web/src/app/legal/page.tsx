import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'À propos & mentions légales' };

export default function LegalIndexPage() {
  return (
    <>
      <h1>À propos d’OpenCoperLock</h1>
      <p>
        OpenCoperLock est un cloud privé open-source et auto-hébergeable : un Drive complet
        couplé à des outils d’acquisition et de sécurité (espaces chiffrés, coffres
        Zero-Knowledge, partage de liens, Quick-Upload et Remote-Upload). Chaque instance est
        hébergée et administrée de façon indépendante par son opérateur.
      </p>

      <h2>Éditeur &amp; créateurs originaux</h2>
      <p>
        OpenCoperLock est créé et maintenu par <strong>Forge Network</strong> —{' '}
        <a href="https://forgenet.fr" target="_blank" rel="noreferrer">forgenet.fr</a>.
        L’instance de référence est opérée sur{' '}
        <a href="https://copper.forgenet.fr" target="_blank" rel="noreferrer">copper.forgenet.fr</a>.
      </p>
      <p>
        Le code source est publié sous licence libre{' '}
        <Link href="/legal/license">GNU AGPLv3</Link>. Vous êtes libre de l’étudier, de le
        modifier et de le redistribuer dans le respect des conditions de cette licence.
      </p>

      <h2>Hébergement</h2>
      <p>
        Cette instance est hébergée par son opérateur. Les fichiers et métadonnées que vous y
        déposez sont stockés sur l’infrastructure choisie par cet opérateur. Pour toute
        question relative à vos données sur cette instance précise, adressez-vous à son
        administrateur.
      </p>

      <h2>Documents</h2>
      <ul>
        <li><Link href="/legal/terms">Conditions d’utilisation</Link></li>
        <li><Link href="/legal/privacy">Politique de confidentialité</Link></li>
        <li><Link href="/legal/license">Licence (GNU AGPLv3)</Link></li>
      </ul>
    </>
  );
}
