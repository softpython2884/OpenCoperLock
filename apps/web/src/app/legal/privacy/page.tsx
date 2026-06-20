import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Confidentialité' };

export default function PrivacyPage() {
  return (
    <>
      <h1>Politique de confidentialité</h1>
      <p>
        OpenCoperLock est auto-hébergé : vos données ne transitent pas par Forge Network mais
        restent sur l’instance opérée par votre administrateur. Cette page décrit la manière
        dont le logiciel traite les données ; l’opérateur de l’instance reste le responsable
        de traitement.
      </p>

      <h2>Données traitées</h2>
      <ul>
        <li><strong>Compte</strong> : adresse e-mail et mot de passe (haché avec argon2id, jamais stocké en clair).</li>
        <li><strong>Fichiers et dossiers</strong> que vous déposez, ainsi que leurs métadonnées (nom, taille, type, date).</li>
        <li><strong>Journaux techniques</strong> : adresse IP, horodatage et type d’action, à des fins de sécurité et d’audit.</li>
        <li><strong>Sessions</strong> : appareil et IP des connexions actives, que vous pouvez révoquer.</li>
      </ul>

      <h2>Chiffrement</h2>
      <p>
        Les fichiers des espaces normaux sont chiffrés au repos côté serveur (AES-256-GCM).
        Les <strong>espaces sécurisés (Zero-Knowledge)</strong> sont chiffrés dans votre
        navigateur avec une phrase de passe que le serveur ne voit jamais : leur contenu est
        techniquement inaccessible à l’opérateur, mais irrécupérable en cas d’oubli.
      </p>

      <h2>Vos droits (RGPD)</h2>
      <p>
        Depuis vos <Link href="/account">paramètres de compte</Link>, vous pouvez à tout
        moment exporter une copie de vos données ou supprimer définitivement votre compte et
        l’ensemble de vos fichiers. Pour toute autre demande, contactez l’administrateur de
        l’instance.
      </p>

      <h2>Sous-traitants &amp; tiers</h2>
      <p>
        Le logiciel ne transmet aucune donnée à des tiers par défaut. Selon la configuration
        de l’instance, des fonctions optionnelles (par exemple une analyse antivirus) peuvent
        être activées par l’opérateur ; renseignez-vous auprès de lui.
      </p>
    </>
  );
}
