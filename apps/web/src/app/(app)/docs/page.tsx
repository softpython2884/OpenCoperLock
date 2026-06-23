'use client';

/**
 * In-app documentation. Bilingual (fr/en) content picked from the active language; kept inline
 * here rather than in the global i18n dictionary since it's long-form and page-local.
 */
import {
  FolderLock,
  Zap,
  KeyRound,
  Webhook,
  HardDrive,
  Keyboard,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { API_URL } from '@/lib/api';
import { useT } from '@/lib/i18n';

type Block = { p: string } | { code: string } | { ul: string[] };
interface Section {
  icon: LucideIcon;
  title: string;
  blocks: Block[];
}

export default function DocsPage() {
  const { lang } = useT();
  const L = (fr: string, en: string) => (lang === 'fr' ? fr : en);

  const sections: Section[] = [
    {
      icon: FolderLock,
      title: L('Espaces & coffres', 'Spaces & vaults'),
      blocks: [
        {
          p: L(
            'Un espace est un dossier de premier niveau. Deux types : « normal » (chiffré côté serveur, AES-256-GCM — analysable par l’antivirus, partageable, aperçu) et « sécurisé » Zero-Knowledge (chiffré dans votre navigateur avec une phrase de passe que le serveur ne voit jamais).',
            'A space is a top-level folder. Two kinds: “normal” (encrypted server-side with AES-256-GCM — antivirus-scannable, shareable, previewable) and a “secured” Zero-Knowledge vault (encrypted in your browser with a passphrase the server never sees).',
          ),
        },
        {
          p: L(
            '⚠️ La phrase de passe d’un coffre est irrécupérable : si vous l’oubliez, le contenu est perdu. Les coffres ne sont ni partageables, ni accessibles par l’API/WebDAV (le serveur ne peut pas les déchiffrer).',
            '⚠️ A vault passphrase is unrecoverable: if you forget it, the contents are lost. Vaults can’t be shared, nor reached via the API/WebDAV (the server can’t decrypt them).',
          ),
        },
      ],
    },
    {
      icon: Zap,
      title: L('Quick-Upload', 'Quick-Upload'),
      blocks: [
        {
          p: L(
            'Créez un code dans Compte ▸ Codes Quick-Upload. N’importe qui (sans compte) peut alors déposer des fichiers dans le dossier choisi via le lien /q?code=…, ou par script :',
            'Create a code in Account ▸ Quick-Upload codes. Anyone (no account) can then drop files into the chosen folder via the /q?code=… link, or by script:',
          ),
        },
        { code: `curl -F "file=@photo.jpg" ${API_URL}/quick/MONCODE` },
        {
          p: L(
            'Options par code : mot de passe, expiration, limite d’utilisations. Les codes sont uniques (ils routent vers votre compte).',
            'Per-code options: password, expiry, usage limit. Codes are unique (they route to your account).',
          ),
        },
      ],
    },
    {
      icon: KeyRound,
      title: L('Jetons d’API (REST)', 'API tokens (REST)'),
      blocks: [
        {
          p: L(
            'Pour automatiser votre compte (scripts, sauvegardes, CI). Créez un jeton dans Compte ▸ Jetons d’API (scopes lecture/écriture, dossier et expiration optionnels). Le jeton n’est affiché qu’une fois.',
            'To automate your account (scripts, backups, CI). Create a token in Account ▸ API tokens (read/write scopes, optional folder and expiry). The token is shown once.',
          ),
        },
        {
          code: `# Vérifier le jeton, lister les dossiers, envoyer un fichier
curl -H "Authorization: Bearer ocl_…" ${API_URL}/api/v1/me
curl -H "Authorization: Bearer ocl_…" ${API_URL}/api/v1/folders
curl -H "Authorization: Bearer ocl_…" -F "file=@backup.tgz" \\
  "${API_URL}/api/v1/files?folderId=<ID>"`,
        },
        {
          p: L(
            'Endpoints : GET /me, GET+POST /folders, GET+POST /files, GET /files/:id/download. Coffres exclus.',
            'Endpoints: GET /me, GET+POST /folders, GET+POST /files, GET /files/:id/download. Vaults excluded.',
          ),
        },
      ],
    },
    {
      icon: HardDrive,
      title: L('WebDAV (disque réseau)', 'WebDAV (network drive)'),
      blocks: [
        {
          p: L(
            'Montez vos espaces normaux comme un disque réseau (Finder, Explorateur Windows, rclone, Cyberduck).',
            'Mount your normal spaces as a network drive (Finder, Windows Explorer, rclone, Cyberduck).',
          ),
        },
        { code: `URL    : ${API_URL}/dav/\n${L('Identifiant', 'Username')} : ${L('votre e-mail (ignoré)', 'your email (ignored)')}\n${L('Mot de passe', 'Password')} : ${L('un jeton d’API (lecture + écriture)', 'an API token (read + write)')}` },
        {
          p: L(
            'Astuce : testez d’abord avec rclone ou Cyberduck (plus tolérants que l’Explorateur Windows). En HTTPS uniquement.',
            'Tip: test first with rclone or Cyberduck (more forgiving than Windows Explorer). HTTPS only.',
          ),
        },
      ],
    },
    {
      icon: Webhook,
      title: L('Webhooks', 'Webhooks'),
      blocks: [
        {
          p: L(
            'Recevez un POST sur une URL à vous quand un fichier arrive (filtre par dossier possible). Le corps est signé en HMAC-SHA256 si vous définissez un secret (en-tête X-OpenCoperLock-Signature).',
            'Get a POST to your own URL when a file arrives (optionally per folder). The body is HMAC-SHA256 signed if you set a secret (header X-OpenCoperLock-Signature).',
          ),
        },
        { code: `{ "event": "file.created", "at": "…", "file": { "id": "…", "name": "…", "sizeBytes": 123 } }` },
      ],
    },
    {
      icon: Keyboard,
      title: L('Raccourcis clavier (Drive)', 'Keyboard shortcuts (Drive)'),
      blocks: [
        {
          ul: [
            L('Ctrl/⌘ + K — palette : rechercher fichiers, dossiers, actions', 'Ctrl/⌘ + K — palette: search files, folders, actions'),
            L('↑ ↓ naviguer · Entrée ouvrir · Retour arrière remonter', '↑ ↓ navigate · Enter open · Backspace go up'),
            L('Ctrl/⌘ + A tout sélectionner · Suppr corbeille · F2 renommer', 'Ctrl/⌘ + A select all · Delete trash · F2 rename'),
            L('Ctrl/⌘ + C / X / V / D copier / couper / coller / dupliquer', 'Ctrl/⌘ + C / X / V / D copy / cut / paste / duplicate'),
            L('Échap retour · clic droit menu · appui long (mobile) sélectionner', 'Esc back · right-click menu · long-press (mobile) to select'),
          ],
        },
      ],
    },
    {
      icon: Globe,
      title: L('Remote-Upload', 'Remote-Upload'),
      blocks: [
        {
          p: L(
            'Collez un lien : le serveur télécharge le fichier directement (protégé contre le SSRF), pratique depuis un appareil à connexion limitée.',
            'Paste a link: the server fetches the file directly (SSRF-guarded), handy from a device on a limited connection.',
          ),
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{L('Documentation', 'Documentation')}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {L('Tout ce que vous pouvez faire avec OpenCoperLock.', 'Everything you can do with OpenCoperLock.')}
        </p>
      </div>

      {sections.map((s) => (
        <section key={s.title} className="card space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-violet-300">
              <s.icon size={18} />
            </span>
            <h2 className="font-semibold text-zinc-100">{s.title}</h2>
          </div>
          {s.blocks.map((b, i) =>
            'p' in b ? (
              <p key={i} className="text-sm leading-relaxed text-zinc-400">
                {b.p}
              </p>
            ) : 'code' in b ? (
              <pre key={i} className="overflow-auto rounded-lg border border-white/[0.06] bg-ink-950/60 p-3 font-mono text-xs leading-relaxed text-zinc-200">
                {b.code}
              </pre>
            ) : (
              <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-400">
                {b.ul.map((li) => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </div>
  );
}
