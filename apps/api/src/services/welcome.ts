import { Readable } from 'node:stream';
import { prisma } from '../db.js';
import { storeUserFile } from './upload.js';
import type { AppContext } from '../context.js';

/** The one-time note placed at the Drive ROOT (folderId = null). It's reachable over WebDAV / the
 *  API, where you *can* drop loose files at the root - unlike the web app, which only shows spaces
 *  (top-level folders). Kept ASCII so it reads cleanly in any editor. */
const ROOT_README = [
  'OpenCoperLock - Drive root',
  '='.repeat(40),
  '',
  '[FR] Vous etes a la RACINE de votre Drive (accessible via WebDAV et l\'API).',
  'Les dossiers que vous voyez ici sont vos ESPACES. Vous pouvez deposer des fichiers',
  'directement a cette racine (comme ce .txt), MAIS ces fichiers-la ne s\'affichent PAS',
  'dans l\'application web OpenCoperLock - seuls les espaces (dossiers) y apparaissent.',
  'Pour retrouver vos fichiers dans l\'app, rangez-les dans un espace. Vous pouvez',
  'supprimer ce fichier sans risque (il ne sera pas recree).',
  '',
  '[EN] You are at the ROOT of your Drive (reachable over WebDAV and the API).',
  'The folders you see here are your SPACES. You can drop files directly at this root',
  '(like this .txt), BUT those root files do NOT show in the OpenCoperLock web app -',
  'only spaces (folders) appear there. To find your files in the app, keep them inside',
  'a space. You can delete this file safely (it will not be recreated).',
  '',
].join('\n');

/** Place OpenCoperLock.txt at the user's Drive root exactly once. Idempotent and best-effort: it
 *  never throws, and the "seeded" flag (not a file-existence check) means a user who deletes the
 *  note keeps it gone. */
export async function ensureRootReadme(ctx: AppContext, ownerId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { rootReadmeSeeded: true },
    });
    if (!user || user.rootReadmeSeeded) return;
    await storeUserFile(ctx, {
      ownerId,
      folderId: null,
      stream: Readable.from([Buffer.from(ROOT_README, 'utf8')]),
      filename: 'OpenCoperLock.txt',
      mimetype: 'text/plain',
    });
    // Only mark as seeded once the write succeeds, so a transient quota/storage error retries later.
    await prisma.user.update({ where: { id: ownerId }, data: { rootReadmeSeeded: true } });
  } catch {
    /* quota exhausted, storage hiccup, race - harmless; we'll try again next time. */
  }
}
