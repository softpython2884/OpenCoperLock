import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Conditions d’utilisation' };

export default function TermsPage() {
  return (
    <>
      <h1>Conditions d’utilisation</h1>
      <p>
        Ces conditions encadrent l’utilisation de cette instance d’OpenCoperLock. L’opérateur
        de l’instance peut les compléter par ses propres règles.
      </p>

      <h2>Usage acceptable</h2>
      <ul>
        <li>N’hébergez pas de contenu illégal ni de contenu portant atteinte aux droits de tiers.</li>
        <li>Ne tentez pas de contourner les quotas, l’authentification ou les limites de débit.</li>
        <li>N’utilisez pas le service pour diffuser des logiciels malveillants ou mener des attaques.</li>
      </ul>

      <h2>Comptes &amp; sécurité</h2>
      <p>
        Vous êtes responsable de la confidentialité de vos identifiants et, le cas échéant, des
        phrases de passe de vos espaces sécurisés (Zero-Knowledge). Une phrase de passe perdue
        rend le contenu correspondant définitivement irrécupérable.
      </p>

      <h2>Disponibilité &amp; garanties</h2>
      <p>
        Le logiciel est fourni « tel quel », sans garantie d’aucune sorte, conformément à la
        licence GNU AGPLv3. L’opérateur ne garantit ni la disponibilité continue du service ni
        l’absence de perte de données ; effectuez vos propres sauvegardes des fichiers
        importants.
      </p>

      <h2>Résiliation</h2>
      <p>
        L’opérateur peut suspendre un compte en cas de violation de ces conditions. Vous pouvez
        à tout moment supprimer votre compte depuis vos paramètres.
      </p>
    </>
  );
}
