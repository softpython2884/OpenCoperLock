'use client';

/**
 * Public, complete documentation. Bilingual (fr/en) content authored inline via the L() helper
 * (long-form and page-local, so it stays out of the global i18n dictionary). A sticky in-page
 * table of contents links to each section.
 */
import Link from 'next/link';
import {
  BookOpen,
  FolderLock,
  Users,
  Files,
  MousePointerClick,
  Keyboard,
  Share2,
  Zap,
  Globe,
  KeyRound,
  Webhook,
  HardDrive,
  ShieldCheck,
  UserCog,
  Smartphone,
  ArrowUpRight,
  Download,
  MousePointer2,
  type LucideIcon,
} from 'lucide-react';
import { API_URL } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Logo } from '@/components/Logo';
import { Wordmark } from '@/components/Wordmark';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

type Block =
  | { h: string }
  | { p: string }
  | { ul: string[] }
  | { ol: string[] }
  | { code: string }
  | { note: string }
  | { warn: string }
  | { btns: { label: string; href: string }[] };

interface Section {
  id: string;
  icon: LucideIcon;
  title: string;
  blocks: Block[];
}

export default function DocsPage() {
  const { lang } = useT();
  const L = (fr: string, en: string) => (lang === 'fr' ? fr : en);

  const sections: Section[] = [
    {
      id: 'intro',
      icon: BookOpen,
      title: L('Présentation', 'Overview'),
      blocks: [
        {
          p: L(
            'OpenCoperLock est un cloud privé auto-hébergeable : un Drive de fichiers classique, augmenté de trois choses que la plupart des outils « dépose un fichier » n’ont pas — un Quick-Upload protégé par code pour n’importe quel appareil, un Remote-Upload côté serveur depuis un lien, et un modèle de chiffrement hybride où vous choisissez, par dossier, entre un chiffrement côté serveur (analysable) et un véritable coffre Zero-Knowledge.',
            'OpenCoperLock is a self-hostable private cloud: a classic file Drive, plus three things most “drop a file” tools lack — a code-gated Quick-Upload for any device, a server-side Remote-Upload from a link, and a hybrid encryption model where you choose, per folder, between server-side encryption (scannable) and a true Zero-Knowledge vault.',
          ),
        },
        {
          ul: [
            L('Stocker, organiser, prévisualiser et éditer des fichiers dans le navigateur.', 'Store, organise, preview and edit files in the browser.'),
            L('Partager par lien (public, par code, ou réservé aux comptes).', 'Share by link (public, by code, or accounts-only).'),
            L('Automatiser via une API REST, des webhooks, ou monter le Drive en WebDAV.', 'Automate via a REST API, webhooks, or mount the Drive over WebDAV.'),
            L('Sécurité : 2FA, antivirus, journal d’audit, export/suppression RGPD.', 'Security: 2FA, antivirus, audit log, GDPR export/erasure.'),
          ],
        },
        { note: L('Open-source sous licence AGPLv3. Si vous hébergez une version modifiée, vos utilisateurs ont droit au code source.', 'Open-source under the AGPLv3. If you host a modified version, your users are entitled to the source.') },
      ],
    },
    {
      id: 'spaces',
      icon: FolderLock,
      title: L('Espaces & coffres', 'Spaces & vaults'),
      blocks: [
        {
          p: L(
            'Un espace est un dossier de premier niveau. À la création, vous choisissez son type — ce choix est définitif et conditionne tout ce qui est possible à l’intérieur.',
            'A space is a top-level folder. When you create it you pick its type — the choice is permanent and governs what’s possible inside.',
          ),
        },
        { h: L('Espace normal (chiffré serveur)', 'Normal space (server-encrypted)') },
        {
          ul: [
            L('Fichiers chiffrés au repos en AES-256-GCM ; les clés sont gérées par le serveur.', 'Files encrypted at rest with AES-256-GCM; keys are managed by the server.'),
            L('Analysable par l’antivirus, partageable, prévisualisable, accessible par l’API/WebDAV.', 'Antivirus-scannable, shareable, previewable, reachable via the API/WebDAV.'),
          ],
        },
        { h: L('Espace sécurisé (Zero-Knowledge)', 'Secured space (Zero-Knowledge)') },
        {
          ul: [
            L('Chiffré dans votre navigateur avec une phrase de passe que le serveur ne voit jamais.', 'Encrypted in your browser with a passphrase the server never sees.'),
            L('Le serveur est aveugle : pas d’aperçu côté serveur, pas de partage, pas d’API/WebDAV.', 'The server is blind: no server-side preview, no sharing, no API/WebDAV.'),
            L('La phrase de passe est demandée une fois par session (gardée pour l’onglet).', 'The passphrase is asked once per session (kept for the tab).'),
          ],
        },
        { warn: L('La phrase de passe d’un coffre est IRRÉCUPÉRABLE. Si vous l’oubliez, le contenu est définitivement perdu — personne ne peut le déchiffrer.', 'A vault passphrase is UNRECOVERABLE. If you forget it, the contents are lost forever — nobody can decrypt them.') },
        { h: L('Espace public / ouvert', 'Public / Open space') },
        {
          ul: [
            L('Chaque fichier obtient une URL directe et publique (/p/<code>) — idéale pour intégrer des images/vidéos sur d’autres sites.', 'Each file gets a direct, public URL (/p/<code>) — ideal for embedding images/videos on other sites.'),
            L('Stocké en clair (non chiffré) pour charger le plus vite possible ; supporte les requêtes de plage (seek vidéo) et un cache long.', 'Stored as plaintext (unencrypted) to load as fast as possible; supports range requests (video seeking) and long caching.'),
            L('Bouton « Copier l’URL publique » sur chaque fichier. Les fichiers restent scannés par l’antivirus à l’envoi.', '“Copy public URL” on each file. Files are still antivirus-scanned on upload.'),
          ],
        },
        { warn: L('Un espace public n’est PAS chiffré et TOUT le monde avec l’URL peut voir le fichier. À réserver aux médias que vous assumez publics.', 'A public space is NOT encrypted and ANYONE with the URL can view the file. Use it only for media you intend to be public.') },
        { h: L('Gérer un espace', 'Managing a space') },
        {
          ul: [
            L('Créer : bouton « Nouvel espace » → nom → type.', 'Create: “New space” → name → type.'),
            L('Supprimer : nécessite de retaper le nom de l’espace (envoi à la corbeille, récupérable un temps).', 'Delete: requires retyping the space name (moves to trash, recoverable for a while).'),
          ],
        },
      ],
    },
    {
      id: 'files',
      icon: Files,
      title: L('Fichiers & dossiers', 'Files & folders'),
      blocks: [
        { h: L('Importer', 'Upload') },
        {
          ul: [
            L('Bouton « Importer » (sélection multiple).', '“Import” button (multi-select).'),
            L('Glisser-déposer depuis le bureau, n’importe où sur la page (un grand overlay apparaît).', 'Drag-and-drop from the desktop anywhere on the page (a full-window overlay appears).'),
            L('Coller (Ctrl/⌘ + V) une image ou du texte du presse-papier : le fichier est créé dans le dossier ouvert.', 'Paste (Ctrl/⌘ + V) an image or text from the clipboard: the file is created in the open folder.'),
            L('Création d’un fichier vide (texte/markdown) qui s’ouvre directement dans l’éditeur.', 'Create an empty (text/markdown) file that opens straight in the editor.'),
            L('Envoi en flux (streaming) : la taille réelle est limitée par votre quota, pas par la RAM.', 'Streaming upload: the real limit is your quota, not RAM.'),
          ],
        },
        { h: L('Ouvrir, éditer, télécharger', 'Open, edit, download') },
        {
          ul: [
            L('Aperçu intégré : images, PDF, vidéo, audio, texte/code (coloration), Markdown, HTML.', 'Built-in preview: images, PDF, video, audio, text/code (highlighting), Markdown, HTML.'),
            L('Édition en ligne des fichiers texte : enregistrer crée une nouvelle version.', 'Inline editing of text files: saving creates a new version.'),
            L('Téléchargement direct, ou en .zip pour une sélection multiple.', 'Direct download, or as a .zip for a multi-selection.'),
          ],
        },
        { h: L('Organiser', 'Organise') },
        {
          ul: [
            L('Renommer, déplacer, dupliquer.', 'Rename, move, duplicate.'),
            L('Copier / couper / coller (Ctrl/⌘ + C / X / V) entre dossiers — espaces normaux.', 'Copy / cut / paste (Ctrl/⌘ + C / X / V) across folders — normal spaces.'),
            L('Compresser une sélection en .zip, ou extraire une archive .zip (recrée l’arborescence).', 'Zip a selection, or extract a .zip archive (recreates its sub-folders).'),
          ],
        },
        { h: L('Versions & corbeille', 'Versions & trash') },
        {
          ul: [
            L('Ré-uploader un fichier texte du même nom conserve l’ancien comme version.', 'Re-uploading a same-named text file keeps the old one as a version.'),
            L('Historique des versions avec diff ligne par ligne et restauration.', 'Version history with a line-by-line diff and restore.'),
            L('Suppression = corbeille (restaurable). Vous choisissez le délai avant purge automatique (défaut 7 jours, ou « Jamais »).', 'Delete = trash (restorable). You pick the delay before auto-purge (default 7 days, or “Never”).'),
            L('Exception : les fichiers d’un coffre Zero-Knowledge sont supprimés immédiatement, sans passer par la corbeille.', 'Exception: Zero-Knowledge vault files are deleted immediately, bypassing the Trash.'),
          ],
        },
      ],
    },
    {
      id: 'navigation',
      icon: MousePointerClick,
      title: L('Navigation & sélection', 'Navigation & selection'),
      blocks: [
        {
          ul: [
            L('Clic sur le nom = ouvrir ; clic ailleurs sur la ligne = sélectionner.', 'Click the name = open; click elsewhere on the row = select.'),
            L('Ctrl/⌘ + clic = ajouter/retirer ; Maj + clic = sélectionner une plage.', 'Ctrl/⌘ + click = toggle; Shift + click = range select.'),
            L('Clic droit = menu contextuel (sans changer la sélection).', 'Right-click = context menu (without changing the selection).'),
            L('Mobile : appui long pour sélectionner, puis tap pour ajouter d’autres éléments.', 'Mobile: long-press to select, then tap to add more items.'),
            L('Sélection multiple → barre d’actions : télécharger (.zip), déplacer, copier, supprimer.', 'Multi-selection → action bar: download (.zip), move, copy, delete.'),
            L('Affichage grille/liste et tri (nom, taille, date) — mémorisés.', 'Grid/list view and sorting (name, size, date) — remembered.'),
          ],
        },
        { h: L('Palette de commandes (Ctrl/⌘ + K)', 'Command palette (Ctrl/⌘ + K)') },
        {
          ul: [
            L('Recherche floue : actions rapides, dossiers/espaces, et recherche globale de fichiers.', 'Fuzzy search: quick actions, folders/spaces, and global file search.'),
            L('Les coffres Zero-Knowledge et leurs fichiers en sont exclus (noms chiffrés).', 'Zero-Knowledge vaults and their files are excluded (encrypted names).'),
          ],
        },
      ],
    },
    {
      id: 'shortcuts',
      icon: Keyboard,
      title: L('Raccourcis clavier', 'Keyboard shortcuts'),
      blocks: [
        {
          ul: [
            'Ctrl/⌘ + K — ' + L('palette : rechercher / agir', 'palette: search / act'),
            L('↑ ↓ naviguer · Entrée ouvrir · Retour arrière remonter d’un dossier', '↑ ↓ navigate · Enter open · Backspace go up a folder'),
            'Ctrl/⌘ + A — ' + L('tout sélectionner', 'select all') + ' · Suppr — ' + L('corbeille', 'trash') + ' · F2 — ' + L('renommer', 'rename'),
            'Ctrl/⌘ + C / X / V / D — ' + L('copier / couper / coller / dupliquer', 'copy / cut / paste / duplicate'),
            'Échap — ' + L('annuler la sélection / revenir en arrière', 'clear selection / go back'),
            '? — ' + L('afficher l’aide des raccourcis', 'show the shortcuts help'),
          ],
        },
      ],
    },
    {
      id: 'sharing',
      icon: Share2,
      title: L('Partage', 'Sharing'),
      blocks: [
        {
          p: L(
            'Partagez un fichier ou un dossier d’un espace normal via un lien. Les coffres ne sont pas partageables (le serveur ne peut pas les déchiffrer).',
            'Share a file or folder from a normal space via a link. Vaults can’t be shared (the server can’t decrypt them).',
          ),
        },
        { h: L('Qui peut ouvrir', 'Who can open') },
        {
          ul: [
            L('Tout le monde : toute personne avec le lien.', 'Everyone: anyone with the link.'),
            L('Avec un code : lien + code d’accès (vérifié, anti-bruteforce).', 'With a code: link + access code (verified, brute-force-throttled).'),
            L('Comptes uniquement : réservé aux utilisateurs connectés.', 'Accounts only: signed-in users only.'),
          ],
        },
        { h: L('Type & limites', 'Type & limits') },
        {
          ul: [
            L('Type de lien : page d’aperçu, ou fichier brut (ouverture directe).', 'Link type: preview page, or raw file (direct open).'),
            L('Expiration, plafond de téléchargements, lecture seule, révocation à tout moment.', 'Expiry, download cap, read-only, revoke any time.'),
            L('Gérez vos liens actifs dans la section « Partages ».', 'Manage your active links in the “Shares” section.'),
          ],
        },
      ],
    },
    {
      id: 'shared-spaces',
      icon: Users,
      title: L('Espaces partagés', 'Shared Spaces'),
      blocks: [
        {
          p: L(
            'Un Espace Partagé est un espace collaboratif appartenant à un seul utilisateur (le propriétaire) et ouvert à un groupe de membres. Contrairement au partage par lien, plusieurs personnes y travaillent ensemble. Les fichiers sont chiffrés côté serveur (jamais Zero-Knowledge — un coffre aveugle ne peut pas être partagé).',
            'A Shared Space is a collaborative area owned by a single user (the owner) and opened to a group of members. Unlike link sharing, several people work in it together. Files are server-side encrypted (never Zero-Knowledge — a blind vault can’t be shared).',
          ),
        },
        { h: L('Rôles', 'Roles') },
        {
          ul: [
            L('Propriétaire : contrôle total ; c’est sur son quota qu’est facturé le stockage de l’espace.', 'Owner: full control; the space’s storage is billed to their quota.'),
            L('Éditeur : peut envoyer, ouvrir, éditer, renommer et supprimer.', 'Editor: can upload, open, edit, rename and delete.'),
            L('Lecteur : peut consulter, ouvrir et télécharger uniquement.', 'Viewer: can browse, open and download only.'),
          ],
        },
        { h: L('Membres', 'Members') },
        {
          ul: [
            L('Le propriétaire ajoute des membres par e-mail (comptes existants de l’instance) et choisit leur rôle.', 'The owner adds members by email (existing accounts on the instance) and picks their role.'),
            L('Un membre peut quitter l’espace ; le propriétaire peut retirer un membre ou changer son rôle.', 'A member can leave; the owner can remove a member or change their role.'),
          ],
        },
        { h: L('Fichiers', 'Files') },
        {
          ul: [
            L('Importer, créer des dossiers, ouvrir/prévisualiser et éditer les fichiers texte (l’enregistrement crée une version).', 'Upload, create folders, open/preview and edit text files (saving creates a version).'),
            L('Tous les fichiers de l’espace comptent sur le quota du propriétaire, peu importe qui les envoie.', 'Every file in the space counts against the owner’s quota, no matter who uploads it.'),
          ],
        },
        { h: L('Cycle de vie', 'Lifecycle') },
        {
          ul: [
            L('À la suppression, le propriétaire choisit : tout supprimer (libère son quota), ou transférer l’espace — et son coût de stockage — au membre le plus ancien.', 'On deletion, the owner chooses: delete everything (frees their quota), or transfer the space — and its storage cost — to the longest-standing member.'),
          ],
        },
        { note: L('Les Espaces Partagés sont isolés : leur contenu n’apparaît jamais dans votre Drive personnel, la recherche, l’API, WebDAV ou l’export.', 'Shared Spaces are isolated: their content never appears in your personal Drive, search, the API, WebDAV or your export.') },
      ],
    },
    {
      id: 'quick',
      icon: Zap,
      title: L('Quick-Upload', 'Quick-Upload'),
      blocks: [
        {
          p: L(
            'Un code permet à n’importe qui (sans compte) de déposer des fichiers dans un dossier que vous choisissez. Chaque utilisateur gère ses propres codes dans Compte ▸ Codes Quick-Upload.',
            'A code lets anyone (no account) drop files into a folder you choose. Each user manages their own codes in Account ▸ Quick-Upload codes.',
          ),
        },
        {
          ul: [
            L('Options : dossier cible, mot de passe, expiration, limite d’utilisations.', 'Options: target folder, password, expiry, usage limit.'),
            L('Lien à partager : /q?code=VOTRECODE (le code se pré-remplit).', 'Shareable link: /q?code=YOURCODE (the code pre-fills).'),
            L('Les codes sont uniques (ils routent le dépôt vers votre compte).', 'Codes are unique (they route the upload to your account).'),
          ],
        },
        { code: `# Dépôt programmatique\ncurl -F "file=@photo.jpg" ${API_URL}/quick/VOTRECODE` },
      ],
    },
    {
      id: 'remote',
      icon: Globe,
      title: L('Remote-Upload', 'Remote-Upload'),
      blocks: [
        {
          p: L(
            'Collez un lien : le serveur télécharge le fichier directement et le range dans votre dossier Fast-Upload. Pratique depuis un appareil à connexion limitée — les octets ne transitent pas par votre appareil.',
            'Paste a link: the server fetches the file directly and files it into your Fast-Upload folder. Handy from a device on a limited connection — the bytes never relay through your device.',
          ),
        },
        { note: L('Protégé contre le SSRF : les adresses privées/localhost et les protocoles non-http sont refusés.', 'SSRF-guarded: private/localhost addresses and non-http protocols are rejected.') },
      ],
    },
    {
      id: 'api',
      icon: KeyRound,
      title: L('Jetons d’API & API REST', 'API tokens & REST API'),
      blocks: [
        {
          p: L(
            'Automatisez votre compte (scripts, sauvegardes, CI). Créez un jeton dans Compte ▸ Jetons d’API : scopes lecture/écriture, restriction à un dossier et expiration optionnelles. Le jeton (ocl_…) n’est affiché qu’une fois ; seul son hachage est stocké.',
            'Automate your account (scripts, backups, CI). Create a token in Account ▸ API tokens: read/write scopes, optional folder restriction and expiry. The token (ocl_…) is shown once; only its hash is stored.',
          ),
        },
        {
          ul: [
            'GET /api/v1/me — ' + L('vérifier le jeton', 'verify the token'),
            'GET · POST /api/v1/folders — ' + L('lister · créer des dossiers', 'list · create folders'),
            'GET · POST /api/v1/files — ' + L('lister · envoyer un fichier (multipart)', 'list · upload a file (multipart)'),
            'GET /api/v1/files/:id/download — ' + L('télécharger', 'download'),
          ],
        },
        {
          code: `curl -H "Authorization: Bearer ocl_…" ${API_URL}/api/v1/me
curl -H "Authorization: Bearer ocl_…" -F "file=@backup.tgz" \\
  "${API_URL}/api/v1/files?folderId=<ID>"`,
        },
        { note: L('Auth par en-tête Bearer (pas de cookie → pas de CSRF). Les coffres ne sont pas accessibles via l’API.', 'Bearer-header auth (no cookie → no CSRF). Vaults aren’t reachable via the API.') },
      ],
    },
    {
      id: 'webhooks',
      icon: Webhook,
      title: L('Webhooks', 'Webhooks'),
      blocks: [
        {
          p: L(
            'Recevez un POST sur une URL à vous quand un fichier arrive (filtre par dossier possible). Idéal pour brancher n8n, Zapier ou un service maison.',
            'Get a POST to your own URL when a file arrives (optionally per folder). Great for wiring n8n, Zapier or a custom service.',
          ),
        },
        { code: `{ "event": "file.created", "at": "…", "file": { "id": "…", "name": "…", "sizeBytes": 123, "mimeType": "…" } }` },
        {
          ul: [
            L('Signé en HMAC-SHA256 si vous définissez un secret (en-tête X-OpenCoperLock-Signature).', 'HMAC-SHA256 signed if you set a secret (header X-OpenCoperLock-Signature).'),
            L('Bouton « Tester », statut/erreur de la dernière livraison, protégé contre le SSRF.', '“Test” button, last delivery status/error, SSRF-guarded.'),
          ],
        },
      ],
    },
    {
      id: 'webdav',
      icon: HardDrive,
      title: L('WebDAV (disque réseau)', 'WebDAV (network drive)'),
      blocks: [
        {
          p: L(
            'Montez vos espaces normaux comme un disque réseau dans Finder, l’Explorateur Windows, rclone ou Cyberduck.',
            'Mount your normal spaces as a network drive in Finder, Windows Explorer, rclone or Cyberduck.',
          ),
        },
        {
          code: `URL    : ${API_URL}/dav/\n${L('Identifiant', 'Username')} : ${L('votre e-mail (ignoré)', 'your email (ignored)')}\n${L('Mot de passe', 'Password')} : ${L('un jeton d’API (lecture + écriture)', 'an API token (read + write)')}`,
        },
        {
          ul: [
            L('Espaces normaux uniquement (les coffres ne sont pas exposés).', 'Normal spaces only (vaults aren’t exposed).'),
            L('Windows : HTTPS requis, service WebClient actif, clé de registre BasicAuthLevel = 2.', 'Windows: HTTPS required, WebClient service running, registry BasicAuthLevel = 2.'),
            L('Derrière un proxy, voir docs/API.md (en-tête X-Forwarded-Prefix).', 'Behind a proxy, see docs/API.md (X-Forwarded-Prefix header).'),
          ],
        },
      ],
    },
    {
      id: 'desktop',
      icon: MousePointer2,
      title: L('Intégrations bureau (clic droit, disque réseau)', 'Desktop integrations (right-click, network drive)'),
      blocks: [
        { h: L('Envoyer vers OpenCoperLock (clic droit)', 'Send to OpenCoperLock (right-click)') },
        {
          p: L(
            'Ajoute au clic droit de votre explorateur (Windows et Linux) de quoi envoyer les fichiers sélectionnés en un clic dans un espace « ComputerShared » de votre Drive, via WebDAV. Sous Windows, l’installeur propose « Envoyer vers → OpenCoperLock » (envoie tout d’un coup) et/ou des entrées « Drop / Multi-Drop on OpenCoperLock ». Tout s’exécute sans fenêtre PowerShell, avec une petite notification en fin de transfert (désactivable).',
            'Adds right-click uploads to your file manager (Windows and Linux): selected files go in one click to a “ComputerShared” space in your Drive, over WebDAV. On Windows the installer offers “Send to → OpenCoperLock” (uploads all at once) and/or “Drop / Multi-Drop on OpenCoperLock” entries. It runs with no PowerShell window and shows a small notification when done (optional).',
          ),
        },
        { note: L('Créez d’abord un jeton d’API non restreint : Compte → Jetons d’API.', 'First create an unrestricted API token: Account → API tokens.') },
        { h: L('Windows', 'Windows') },
        {
          p: L(
            'Ouvrez PowerShell et lancez (aucun droit administrateur requis) :',
            'Open PowerShell and run (no administrator rights needed):',
          ),
        },
        { code: 'irm https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/send-to/windows/install-windows.ps1 | iex' },
        { h: L('Linux', 'Linux') },
        { p: L('GNOME Files, Cinnamon (Nemo) et KDE Dolphin. Dans un terminal :', 'GNOME Files, Cinnamon (Nemo) and KDE Dolphin. In a terminal:') },
        { code: 'curl -fsSL https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/send-to/linux/install-linux.sh | bash' },
        {
          btns: [
            { label: L('Télécharger l’installeur Windows (.cmd)', 'Download Windows installer (.cmd)'), href: 'https://github.com/softpython2884/OpenCoperLock/raw/main/scripts/send-to/windows/install-windows.cmd' },
            { label: L('Voir les scripts sur GitHub', 'View the scripts on GitHub'), href: 'https://github.com/softpython2884/OpenCoperLock/tree/main/scripts/send-to' },
          ],
        },
        { h: L('Monter le Drive en disque réseau (Windows)', 'Mount the Drive as a network drive (Windows)') },
        {
          p: L(
            'Le client WebDAV de Windows est capricieux (voir la section WebDAV). Ce script configure le service WebClient, corrige les réglages qui bloquent, puis monte votre Drive sur une lettre (X: par défaut). Lancez dans PowerShell :',
            'Windows’ WebDAV client is finicky (see the WebDAV section). This script configures the WebClient service, fixes the settings that block it, then maps your Drive to a letter (X: by default). Run in PowerShell:',
          ),
        },
        { code: '$f="$env:TEMP\\ocl-mount.ps1"; irm https://raw.githubusercontent.com/softpython2884/OpenCoperLock/main/scripts/mount-opencoperlock-windows.ps1 -OutFile $f; powershell -ExecutionPolicy Bypass -File $f' },
        {
          btns: [
            { label: L('Télécharger le script (.cmd)', 'Download the script (.cmd)'), href: 'https://github.com/softpython2884/OpenCoperLock/raw/main/scripts/mount-opencoperlock-windows.cmd' },
            { label: L('Télécharger le script (.ps1)', 'Download the script (.ps1)'), href: 'https://github.com/softpython2884/OpenCoperLock/raw/main/scripts/mount-opencoperlock-windows.ps1' },
          ],
        },
        { note: L('Un prompt UAC apparaît uniquement pour la partie qui règle le service WebClient. Le mappage du lecteur reste en session utilisateur.', 'A UAC prompt appears only for the part that configures the WebClient service. The drive mapping stays in your user session.') },
        { h: L('Ranger le menu clic droit (Windows)', 'Tidy the right-click menu (Windows)') },
        {
          p: L(
            'Les applications ajoutent sans cesse des entrées au menu contextuel de l’Explorateur. Ce petit outil liste toutes les entrées (verbes classiques et extensions shell) et permet d’activer/désactiver celles qui ne servent pas. Rien n’est supprimé — la désactivation est réversible.',
            'Apps keep piling entries into Explorer’s context menu. This small tool lists every entry (classic verbs and shell extensions) and lets you enable/disable the ones you don’t use. Nothing is deleted — disabling is reversible.',
          ),
        },
        {
          btns: [
            { label: L('Télécharger l’outil (.cmd)', 'Download the tool (.cmd)'), href: 'https://github.com/softpython2884/OpenCoperLock/raw/main/scripts/windows-context-menu-manager.cmd' },
            { label: L('Voir le script (.ps1)', 'View the script (.ps1)'), href: 'https://github.com/softpython2884/OpenCoperLock/blob/main/scripts/windows-context-menu-manager.ps1' },
          ],
        },
      ],
    },
    {
      id: 'security',
      icon: ShieldCheck,
      title: L('Sécurité & confidentialité', 'Security & privacy'),
      blocks: [
        {
          ul: [
            L('Chiffrement : AES-256-GCM au repos (espaces normaux) ; coffres chiffrés dans le navigateur (Zero-Knowledge).', 'Encryption: AES-256-GCM at rest (normal spaces); vaults encrypted in the browser (Zero-Knowledge).'),
            L('Double authentification (TOTP) avec QR code et codes de récupération à usage unique.', 'Two-factor (TOTP) with a QR code and one-time recovery codes.'),
            L('Sessions : liste des appareils connectés (IP, navigateur), révocation individuelle ou globale.', 'Sessions: list of signed-in devices (IP, browser), revoke individually or all others.'),
            L('Antivirus : analyse ClamAV à l’upload (mise en quarantaine des fichiers infectés) + recherche VirusTotal par hash à la demande.', 'Antivirus: ClamAV scan on upload (infected files quarantined) + on-demand VirusTotal hash lookup.'),
            L('Téléchargements protégés : chaque route est liée au propriétaire ; une URL d’API partagée est inutilisable par un autre compte.', 'Protected downloads: every route is owner-scoped; a shared API URL is useless to another account.'),
            L('Protection CSRF (double-submit), limitation de débit, en-têtes de sécurité (Helmet).', 'CSRF protection (double-submit), rate limiting, security headers (Helmet).'),
            L('Journal d’audit des actions sensibles.', 'Audit log of sensitive actions.'),
            L('RGPD : export d’une copie de vos données, suppression définitive du compte.', 'GDPR: export a copy of your data, permanently delete your account.'),
          ],
        },
      ],
    },
    {
      id: 'account',
      icon: UserCog,
      title: L('Paramètres du compte', 'Account settings'),
      blocks: [
        {
          ul: [
            L('Double authentification (activer/désactiver, régénérer les codes de récupération).', 'Two-factor (enable/disable, regenerate recovery codes).'),
            L('Sessions actives (révoquer les autres appareils).', 'Active sessions (revoke other devices).'),
            L('Codes Quick-Upload, jetons d’API, webhooks, et le point de montage WebDAV.', 'Quick-Upload codes, API tokens, webhooks, and the WebDAV mount point.'),
            L('Données & confidentialité : export JSON, suppression du compte.', 'Data & privacy: JSON export, account deletion.'),
          ],
        },
      ],
    },
    {
      id: 'admin',
      icon: UserCog,
      title: L('Administration', 'Administration'),
      blocks: [
        {
          ul: [
            L('Utilisateurs : créer, définir un quota par utilisateur, activer/désactiver.', 'Users: create, set a per-user quota, enable/disable.'),
            L('Vider le stockage d’un utilisateur (fichiers, dossiers et espaces qu’il possède) sans supprimer son compte.', 'Empty a user’s storage (their files, folders and owned spaces) without deleting the account.'),
            L('Plafond de stockage global de l’instance.', 'Instance-wide storage cap.'),
            L('Clé VirusTotal configurable depuis le panneau (prime sur le .env, appliquée à chaud).', 'VirusTotal key configurable from the panel (overrides .env, applied live).'),
            L('Vue globale des codes Quick-Upload et journal d’audit.', 'Global view of Quick-Upload codes and the audit log.'),
          ],
        },
        { h: L('Mises à jour', 'Updates') },
        {
          ul: [
            L('Mise à jour en un clic (git + build + redémarrage, avec health-check et restauration automatique en cas d’échec).', 'One-click update (git + build + restart, with health-check and automatic rollback on failure).'),
            L('Mises à jour automatiques (option) : l’instance vérifie GitHub plusieurs fois par jour et applique une nouvelle version toute seule.', 'Automatic updates (optional): the instance checks GitHub a few times a day and applies a newer build on its own.'),
            L('Revenir en arrière : choisir une version précédente dans l’historique pour y restaurer le déploiement.', 'Roll back: pick an earlier version from the history to restore the deployment to it.'),
            L('Après une mise à jour, chaque utilisateur voit une fois un « Quoi de neuf » avec les nouveautés.', 'After an update, each user sees a one-time “What’s new” with the changes.'),
          ],
        },
      ],
    },
    {
      id: 'mobile',
      icon: Smartphone,
      title: L('Mobile & PWA', 'Mobile & PWA'),
      blocks: [
        {
          ul: [
            L('Interface adaptée au mobile ; installable comme application (PWA).', 'Mobile-friendly UI; installable as an app (PWA).'),
            L('Appui long pour sélectionner, glisser-déposer, et toutes les actions du menu.', 'Long-press to select, drag-and-drop, and all menu actions.'),
            L('Mode hors-ligne : l’app s’ouvre sans réseau et propose d’envoyer des fichiers ; ils sont gardés sur l’appareil et synchronisés automatiquement au retour de la connexion.', 'Offline mode: the app opens with no network and lets you queue file uploads; they’re kept on the device and synced automatically when the connection returns.'),
            L('Le Quick-Upload est parfait pour envoyer depuis un téléphone sans se connecter.', 'Quick-Upload is perfect for sending from a phone without signing in.'),
          ],
        },
      ],
    },
  ];

  return (
    <div className="min-h-screen">
      {/* header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={30} />
            <Wordmark />
            <span className="ml-1 hidden text-sm text-zinc-500 sm:inline">· {L('Documentation', 'Documentation')}</span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link href="/drive" className="btn-primary px-3 py-1.5 text-sm">
              {L('Ouvrir l’app', 'Open the app')} <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[15rem_1fr]">
        {/* table of contents */}
        <aside className="hidden lg:block">
          <nav className="sticky top-20 space-y-1">
            <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">{L('Sommaire', 'Contents')}</p>
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100"
              >
                <s.icon size={15} className="shrink-0 text-zinc-500" />
                {s.title}
              </a>
            ))}
          </nav>
        </aside>

        {/* content */}
        <main className="min-w-0 space-y-10">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">{L('Documentation', 'Documentation')}</h1>
            <p className="mt-2 text-zinc-400">
              {L(
                'Tout ce qu’OpenCoperLock sait faire — fonctionnalités, ce que vous pouvez faire, et comment.',
                'Everything OpenCoperLock can do — features, what you can do, and how.',
              )}
            </p>
          </div>

          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-violet-300">
                  <s.icon size={18} />
                </span>
                <h2 className="text-xl font-semibold text-white">{s.title}</h2>
              </div>
              <div className="space-y-3 border-l border-white/[0.06] pl-4">
                {s.blocks.map((b, i) =>
                  'h' in b ? (
                    <h3 key={i} className="pt-1 text-sm font-semibold uppercase tracking-wide text-zinc-300">
                      {b.h}
                    </h3>
                  ) : 'p' in b ? (
                    <p key={i} className="text-sm leading-relaxed text-zinc-400">
                      {b.p}
                    </p>
                  ) : 'code' in b ? (
                    <pre key={i} className="overflow-auto rounded-lg border border-white/[0.06] bg-ink-950/60 p-3 font-mono text-xs leading-relaxed text-zinc-200">
                      {b.code}
                    </pre>
                  ) : 'note' in b ? (
                    <p key={i} className="rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-3 py-2 text-sm text-violet-100/90">
                      {b.note}
                    </p>
                  ) : 'warn' in b ? (
                    <p key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-100/90">
                      ⚠️ {b.warn}
                    </p>
                  ) : 'btns' in b ? (
                    <div key={i} className="flex flex-wrap gap-2 pt-1">
                      {b.btns.map((btn) => (
                        <a
                          key={btn.href}
                          href={btn.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-zinc-200 transition hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-white"
                        >
                          <Download size={15} /> {btn.label}
                        </a>
                      ))}
                    </div>
                  ) : 'ol' in b ? (
                    <ol key={i} className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-zinc-400">
                      {b.ol.map((li) => (
                        <li key={li}>{li}</li>
                      ))}
                    </ol>
                  ) : (
                    <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-400">
                      {b.ul.map((li) => (
                        <li key={li}>{li}</li>
                      ))}
                    </ul>
                  ),
                )}
              </div>
            </section>
          ))}

          <footer className="border-t border-white/[0.06] pt-6 text-sm text-zinc-500">
            {L('Besoin de plus de détails techniques ? Voir ', 'Need more technical detail? See ')}
            <a className="text-violet-300 hover:underline" href="https://github.com/softpython2884/OpenCoperLock/blob/main/docs/API.md">
              docs/API.md
            </a>
            {L(' (API REST, webhooks, WebDAV, exemples curl/rclone).', ' (REST API, webhooks, WebDAV, curl/rclone examples).')}
          </footer>
        </main>
      </div>
    </div>
  );
}
