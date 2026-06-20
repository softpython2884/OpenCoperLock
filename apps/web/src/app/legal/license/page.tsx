import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Licence' };

export default function LicensePage() {
  return (
    <>
      <h1>Licence</h1>
      <p>
        OpenCoperLock est un logiciel libre distribué sous licence{' '}
        <strong>GNU Affero General Public License v3.0</strong> (AGPLv3).
      </p>

      <h2>En résumé</h2>
      <ul>
        <li>Vous pouvez utiliser, étudier, modifier et redistribuer le logiciel.</li>
        <li>
          Toute version modifiée redistribuée — y compris mise à disposition via un service en
          réseau — doit publier son code source sous la même licence.
        </li>
        <li>Le logiciel est fourni « tel quel », sans aucune garantie.</li>
      </ul>
      <p className="text-sm text-zinc-500">
        Ce résumé n’a pas de valeur juridique ; seul le texte intégral de la licence fait foi.
      </p>

      <h2>Texte intégral</h2>
      <p>
        Le texte complet de la licence est disponible dans le fichier <code>LICENSE</code> du
        dépôt du projet et sur{' '}
        <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">
          gnu.org/licenses/agpl-3.0
        </a>
        .
      </p>

      <h2>Droits d’auteur</h2>
      <p>
        © Forge Network (<a href="https://forgenet.fr" target="_blank" rel="noreferrer">forgenet.fr</a>) et
        les contributeurs d’OpenCoperLock.
      </p>
    </>
  );
}
