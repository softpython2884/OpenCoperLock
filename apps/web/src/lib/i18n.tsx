'use client';

/**
 * Lightweight i18n for the web client (French + English). A flat key → string dictionary per
 * language, a `t(key, vars?)` lookup with `{var}` interpolation, and a persisted language
 * choice (localStorage, defaulting to the browser language). Server components that can't use
 * the hook keep their own copy; this covers the interactive app surfaces.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'fr' | 'en';

type Dict = Record<string, string>;

const fr: Dict = {
  // common
  'common.cancel': 'Annuler',
  'common.confirm': 'Confirmer',
  'common.save': 'Enregistrer',
  'common.delete': 'Supprimer',
  'common.download': 'Télécharger',
  'common.open': 'Ouvrir',
  'common.rename': 'Renommer',
  'common.move': 'Déplacer',
  'common.share': 'Partager',
  'common.restore': 'Restaurer',
  'common.loading': 'Chargement…',
  'common.signin': 'Se connecter',
  'common.signout': 'Se déconnecter',
  'common.opFailed': 'Opération impossible',
  // trash
  'trash.title': 'Corbeille',
  'trash.subtitle': 'Les éléments supprimés sont conservés ici, puis effacés automatiquement après un délai.',
  'trash.empty': 'Vider la corbeille',
  'trash.emptyTitle': 'La corbeille est vide',
  'trash.emptyHint': 'Les fichiers et dossiers supprimés apparaîtront ici.',
  'trash.restored': 'Restauré',
  'trash.restoreFailed': 'Restauration impossible',
  'trash.purgeTitle': 'Supprimer définitivement ?',
  'trash.purgeMsg': '« {name} » sera détruit et ne pourra plus être récupéré.',
  'trash.purged': 'Supprimé définitivement',
  'trash.purgeFailed': 'Suppression impossible',
  'trash.purgeForever': 'Supprimer définitivement',
  'trash.emptyConfirmTitle': 'Vider la corbeille ?',
  'trash.emptyConfirmMsg': 'Tous les éléments seront détruits définitivement.',
  'trash.emptyConfirmBtn': 'Tout supprimer',
  'trash.emptied': 'Corbeille vidée',
  'trash.folder': 'Dossier',
  'trash.file': 'Fichier',
  'trash.deletedOn': 'supprimé le {date}',
  // nav
  'nav.spaces': 'Mes Espaces',
  'nav.shares': 'Partages',
  'nav.remote': 'Remote',
  'nav.trash': 'Corbeille',
  'nav.admin': 'Administration',
  'nav.settings': 'Paramètres',
  'nav.storage': 'Stockage',
  'role.admin': 'Administrateur',
  'role.user': 'Utilisateur',
  // login
  'login.subtitle': 'Connectez-vous à votre cloud privé',
  'login.email': 'Email',
  'login.password': 'Mot de passe',
  'login.totp': 'Code à deux facteurs',
  'login.totpHint': 'Saisissez le code à 6 chiffres de votre application, ou un code de secours.',
  'login.totpPlaceholder': '123456 ou code de secours',
  'login.signingIn': 'Connexion…',
  'login.verify': 'Vérifier',
  'login.failed': 'Connexion impossible',
  'login.codeIncorrect': 'Code incorrect. Réessayez.',
  'login.quickPrompt': 'Vous avez un code Quick-Upload ?',
  'login.openSource': 'Open-source (AGPLv3) · par',
  'legal.about': 'À propos',
  'legal.terms': 'Conditions',
  'legal.privacy': 'Confidentialité',
  'legal.license': 'Licence',
};

const en: Dict = {
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.download': 'Download',
  'common.open': 'Open',
  'common.rename': 'Rename',
  'common.move': 'Move',
  'common.share': 'Share',
  'common.restore': 'Restore',
  'common.loading': 'Loading…',
  'common.signin': 'Sign in',
  'common.signout': 'Sign out',
  'common.opFailed': 'Operation failed',
  'trash.title': 'Trash',
  'trash.subtitle': 'Deleted items are kept here, then removed automatically after a while.',
  'trash.empty': 'Empty trash',
  'trash.emptyTitle': 'The trash is empty',
  'trash.emptyHint': 'Deleted files and folders will appear here.',
  'trash.restored': 'Restored',
  'trash.restoreFailed': 'Could not restore',
  'trash.purgeTitle': 'Delete permanently?',
  'trash.purgeMsg': '“{name}” will be destroyed and cannot be recovered.',
  'trash.purged': 'Permanently deleted',
  'trash.purgeFailed': 'Could not delete',
  'trash.purgeForever': 'Delete permanently',
  'trash.emptyConfirmTitle': 'Empty the trash?',
  'trash.emptyConfirmMsg': 'All items will be permanently destroyed.',
  'trash.emptyConfirmBtn': 'Delete everything',
  'trash.emptied': 'Trash emptied',
  'trash.folder': 'Folder',
  'trash.file': 'File',
  'trash.deletedOn': 'deleted on {date}',
  'nav.spaces': 'My Spaces',
  'nav.shares': 'Shares',
  'nav.remote': 'Remote',
  'nav.trash': 'Trash',
  'nav.admin': 'Administration',
  'nav.settings': 'Settings',
  'nav.storage': 'Storage',
  'role.admin': 'Administrator',
  'role.user': 'User',
  'login.subtitle': 'Sign in to your private cloud',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.totp': 'Two-factor code',
  'login.totpHint': 'Enter the 6-digit code from your authenticator app, or a recovery code.',
  'login.totpPlaceholder': '123456 or recovery code',
  'login.signingIn': 'Signing in…',
  'login.verify': 'Verify',
  'login.failed': 'Sign-in failed',
  'login.codeIncorrect': 'Incorrect code. Try again.',
  'login.quickPrompt': 'Have a Quick-Upload code?',
  'login.openSource': 'Open-source (AGPLv3) · by',
  'legal.about': 'About',
  'legal.terms': 'Terms',
  'legal.privacy': 'Privacy',
  'legal.license': 'License',
};

const dictionaries: Record<Lang, Dict> = { fr, en };

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Default to French on first render (matches the server) to avoid a hydration mismatch,
  // then adopt the saved / browser preference on mount.
  const [lang, setLangState] = useState<Lang>('fr');

  useEffect(() => {
    const saved = localStorage.getItem('ocl_lang');
    if (saved === 'fr' || saved === 'en') setLangState(saved);
    else if (navigator.language?.toLowerCase().startsWith('en')) setLangState('en');
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('ocl_lang', l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let s = dictionaries[lang][key] ?? dictionaries.fr[key] ?? key;
      if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, String(vars[k]));
      return s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nCtx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used within I18nProvider');
  return ctx;
}
