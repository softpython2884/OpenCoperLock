'use client';

/**
 * "Mes Espaces" — the main workspace. A Space is a top-level folder that is either:
 *   - normal   : files are encrypted server-side (AES-256-GCM at rest), or
 *   - secured  : a Zero-Knowledge vault, encrypted in the browser with a passphrase the
 *                server never sees. The passphrase is cached in sessionStorage for the tab
 *                so it is asked once per session, then used to derive the vault key.
 *
 * Inside a space you can create folders & files, upload (full-window drag & drop + progress),
 * open files in an in-app viewer/editor, download, delete, rename / move / share / browse
 * versions, and work with the keyboard: multi-selection, a Ctrl/⌘+K command palette, sortable
 * columns, and copy / cut / paste / duplicate (normal spaces). All prompts use the in-app dialogs.
 *
 * NOTE: Zero-Knowledge vault files have no server-side move/rename/copy (encrypted in place), so
 * clipboard and bulk-move are offered for normal spaces only; delete & download work everywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder,
  FolderLock,
  FolderPlus,
  FilePlus,
  Upload,
  LayoutGrid,
  List as ListIcon,
  Download,
  Trash2,
  Pencil,
  FolderInput,
  Share2,
  History,
  Plus,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Home,
  Lock,
  Globe,
  Link2,
  ShieldCheck,
  KeyRound,
  Eye,
  Copy,
  Scissors,
  ClipboardPaste,
  Files,
  Keyboard,
  ArrowDownUp,
  Archive,
  PackageOpen,
  Check,
  X,
} from 'lucide-react';
import { zip as fzip, unzip as funzip } from 'fflate';
import type { PublicFile, PublicFolder } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOffline } from '@/lib/offline';
import { OfflineView } from '@/components/OfflineView';
import { useT } from '@/lib/i18n';
import {
  checkVerifier,
  decryptBlob,
  decryptName,
  deriveVaultKey,
  encryptFile,
  makeVerifier,
  randomSalt,
} from '@/lib/zk';
import { fileVisual } from '@/lib/fileType';
import { signalDownload } from '@/lib/downloadFx';
import { FileViewer, type ViewerSource } from '@/components/FileViewer';
import { confirm, prompt, choose, toast } from '@/components/ui/overlays';
import { DropOverlay } from '@/components/drive/DropOverlay';
import { CommandPalette, type PaletteItem } from '@/components/drive/CommandPalette';
import { ShortcutsHelp } from '@/components/drive/ShortcutsHelp';
import { VersionHistory } from '@/components/drive/VersionHistory';
import { ContextMenu } from '@/components/drive/ContextMenu';
import { Menu, type MenuItem } from '@/components/ui/Menu';

interface ZkFile {
  id: string;
  encryptedName: string;
  iv: string;
  wrappedKey: string;
  sizeBytes: number;
  createdAt: string;
  plainName?: string;
}

type SortKey = 'name' | 'size' | 'date';
interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

// A unified, display-ordered item so selection/keyboard logic works across folders & files.
type Entry =
  | { key: string; kind: 'folder'; name: string; size: number; date: number; folder: PublicFolder }
  | { key: string; kind: 'file'; name: string; size: number; date: number; file: PublicFile }
  | { key: string; kind: 'zk'; name: string; size: number; date: number; zk: ZkFile };

interface ClipItem {
  kind: 'folder' | 'file';
  id: string;
  name: string;
  mimeType?: string;
  sourceFolderId: string | null;
}
interface Clipboard {
  op: 'copy' | 'cut';
  items: ClipItem[];
}

function passKey(spaceId: string) {
  return `ocl_pass_${spaceId}`;
}

export default function EspacesPage() {
  const { user, refresh } = useAuth();
  const { online, enqueueForRetry } = useOffline();
  const { t } = useT();
  const [allFolders, setAllFolders] = useState<PublicFolder[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [zkFiles, setZkFiles] = useState<ZkFile[]>([]);
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<ViewerSource | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [versionsFor, setVersionsFor] = useState<PublicFile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // selection / clipboard / overlays
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // passphrase prompt
  const [askPass, setAskPass] = useState<PublicFolder | null>(null);
  const [passInput, setPassInput] = useState('');
  const [passError, setPassError] = useState<string | null>(null);

  // Restore persisted view/sort once on mount. With no saved choice, default by screen size:
  // mosaic (grid) on small screens, list on large ones.
  useEffect(() => {
    try {
      const v = localStorage.getItem('ocl_view');
      if (v === 'grid' || v === 'list') setView(v);
      else setView(window.matchMedia('(max-width: 640px)').matches ? 'grid' : 'list');
      const s = localStorage.getItem('ocl_sort');
      if (s) {
        const parsed = JSON.parse(s) as Sort;
        if (parsed?.key && parsed?.dir) setSort(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('ocl_view', view);
    } catch {
      /* ignore */
    }
  }, [view]);
  useEffect(() => {
    try {
      localStorage.setItem('ocl_sort', JSON.stringify(sort));
    } catch {
      /* ignore */
    }
  }, [sort]);

  const spaces = useMemo(() => allFolders.filter((f) => f.parentId === null), [allFolders]);
  const activeSpace = useMemo(
    () => allFolders.find((f) => f.id === activeSpaceId) ?? null,
    [allFolders, activeSpaceId],
  );
  const isZk = activeSpace?.isZeroKnowledge ?? false;
  const isPublic = activeSpace?.isPublic ?? false;
  const needPass = isZk && !vaultKey;

  /** Public URL for a file in a Public/Open space (empty if the file isn't public yet). */
  function publicUrl(f: PublicFile): string {
    return f.publicSlug ? `${API_URL}/p/${f.publicSlug}/${encodeURIComponent(f.name)}` : '';
  }
  async function copyPublicUrl(f: PublicFile) {
    const url = publicUrl(f);
    if (!url) return;
    await navigator.clipboard?.writeText(url).catch(() => {});
    toast(t('drive.publicUrlCopied'), 'success');
  }
  const childFolders = useMemo(
    () => allFolders.filter((f) => f.parentId === currentFolderId),
    [allFolders, currentFolderId],
  );

  // Folders first, then files/zk; each group sorted by the active column.
  const entries = useMemo<Entry[]>(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const cmp = (a: Entry, b: Entry) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * dir;
      if (sort.key === 'size') return (a.size - b.size) * dir;
      return (a.date - b.date) * dir;
    };
    const folders: Entry[] = childFolders.map((f) => ({
      key: `folder:${f.id}`,
      kind: 'folder',
      name: f.name,
      size: 0,
      date: Date.parse(f.createdAt),
      folder: f,
    }));
    const fileEntries: Entry[] = files.map((f) => ({
      key: `file:${f.id}`,
      kind: 'file',
      name: f.name,
      size: f.sizeBytes,
      date: Date.parse(f.createdAt),
      file: f,
    }));
    const zkEntries: Entry[] = zkFiles.map((f) => ({
      key: `zk:${f.id}`,
      kind: 'zk',
      name: f.plainName ?? '🔒',
      size: f.sizeBytes,
      date: Date.parse(f.createdAt),
      zk: f,
    }));
    folders.sort(cmp);
    return [...folders, ...[...fileEntries, ...zkEntries].sort(cmp)];
  }, [childFolders, files, zkFiles, sort]);

  const breadcrumb = useMemo(() => {
    const path: PublicFolder[] = [];
    let cursor = currentFolderId;
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    while (cursor) {
      const f = byId.get(cursor);
      if (!f) break;
      path.unshift(f);
      cursor = f.parentId;
    }
    return path;
  }, [currentFolderId, allFolders]);

  const loadFolders = useCallback(async () => {
    const res = await api.get<{ folders: PublicFolder[] }>('/folders');
    setAllFolders(res.folders);
    // Cache the folder list so the offline view can offer a destination picker.
    try {
      localStorage.setItem('ocl_folders', JSON.stringify(res.folders));
    } catch {
      /* storage unavailable */
    }
    return res.folders;
  }, []);

  const loadItems = useCallback(async (folderId: string, zk: boolean, key: CryptoKey | null) => {
    if (zk) {
      const res = await api.get<{ files: ZkFile[] }>(`/zk/files?folderId=${folderId}`);
      const withNames = key
        ? await Promise.all(
            res.files.map(async (f) => ({
              ...f,
              plainName: await decryptName(key, f.encryptedName, f.wrappedKey),
            })),
          )
        : res.files;
      setZkFiles(withNames);
      setFiles([]);
    } else {
      const res = await api.get<{ files: PublicFile[] }>(`/files?folderId=${folderId}`);
      setFiles(res.files);
      setZkFiles([]);
    }
  }, []);

  useEffect(() => {
    void loadFolders().catch((e) => setError(String(e)));
  }, [loadFolders]);

  useEffect(() => {
    if (!activeSpaceId || !currentFolderId) return;
    if (isZk && !vaultKey) return; // wait for passphrase
    void loadItems(currentFolderId, isZk, vaultKey).catch((e) => setError(String(e)));
  }, [activeSpaceId, currentFolderId, isZk, vaultKey, loadItems]);

  // Clear selection whenever the visible folder changes.
  useEffect(() => {
    setSelected(new Set());
    setAnchorKey(null);
  }, [currentFolderId, activeSpaceId]);

  async function enterSpace(space: PublicFolder) {
    setError(null);
    setActiveSpaceId(space.id);
    setCurrentFolderId(space.id);
    setVaultKey(null);
    if (space.isZeroKnowledge) {
      const cached = sessionStorage.getItem(passKey(space.id));
      if (cached) {
        const key = await deriveVaultKey(cached, space.zkSalt);
        if (!space.zkVerifier || (await checkVerifier(key, space.zkVerifier))) {
          setVaultKey(key);
          return;
        }
        sessionStorage.removeItem(passKey(space.id));
      }
      setPassInput('');
      setPassError(null);
      setAskPass(space);
    }
  }

  async function submitPassphrase() {
    if (!askPass || !passInput) return;
    const key = await deriveVaultKey(passInput, askPass.zkSalt);
    if (askPass.zkVerifier && !(await checkVerifier(key, askPass.zkVerifier))) {
      setPassError(t('drive.passphraseWrong'));
      return;
    }
    sessionStorage.setItem(passKey(askPass.id), passInput);
    setVaultKey(key);
    setAskPass(null);
    setPassInput('');
    setPassError(null);
  }

  function leaveSpace() {
    setActiveSpaceId(null);
    setCurrentFolderId(null);
    setVaultKey(null);
    setFiles([]);
    setZkFiles([]);
  }

  // Navigate to any folder anywhere (used by the command palette).
  function jumpToFolder(f: PublicFolder) {
    if (f.parentId === null) {
      void enterSpace(f);
      return;
    }
    const byId = new Map(allFolders.map((x) => [x.id, x]));
    let space: PublicFolder = f;
    while (space.parentId) {
      const parent = byId.get(space.parentId);
      if (!parent) break;
      space = parent;
    }
    if (space.id !== activeSpaceId) {
      void enterSpace(space).then(() => setCurrentFolderId(f.id));
    } else {
      setCurrentFolderId(f.id);
    }
  }

  function goParent() {
    if (!currentFolderId || !activeSpace) return;
    if (currentFolderId === activeSpace.id) {
      leaveSpace();
      return;
    }
    const cur = allFolders.find((f) => f.id === currentFolderId);
    setCurrentFolderId(cur?.parentId ?? activeSpace.id);
  }

  async function createSpace() {
    const name = await prompt({ title: t('drive.newSpaceTitle'), label: t('drive.spaceNameLabel'), placeholder: t('drive.spaceNamePlaceholder') });
    if (!name) return;
    const kind = await choose<'normal' | 'secured' | 'public'>({
      title: t('drive.spaceTypeTitle'),
      message: t('drive.spaceTypeMsg'),
      options: [
        { value: 'normal', label: t('drive.spaceNormal'), description: t('drive.spaceNormalDesc') },
        { value: 'secured', label: t('drive.spaceSecured'), description: t('drive.spaceSecuredDesc') },
        { value: 'public', label: t('drive.spacePublic'), description: t('drive.spacePublicDesc') },
      ],
    });
    if (!kind) return;

    if (kind === 'public') {
      try {
        await api.post('/folders', { name, isPublic: true });
        await loadFolders();
        toast(t('drive.publicSpaceCreated'), 'success');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('common.createFailed'));
      }
      return;
    }

    if (kind === 'secured') {
      const pass = await prompt({
        title: t('drive.vaultPassTitle'),
        message: t('drive.vaultPassMsg'),
        label: t('drive.vaultPassLabel'),
        password: true,
      });
      if (!pass) return;
      const again = await prompt({ title: t('drive.vaultPassConfirmTitle'), label: t('drive.vaultPassConfirmLabel'), password: true });
      if (again === null) return;
      if (again !== pass) {
        toast(t('drive.passMismatch'), 'error');
        return;
      }
      try {
        const salt = randomSalt();
        const key = await deriveVaultKey(pass, salt);
        const verifier = await makeVerifier(key);
        const res = await api.post<{ folder: PublicFolder }>('/folders', {
          name,
          isZeroKnowledge: true,
          zkSalt: salt,
          zkVerifier: verifier,
        });
        sessionStorage.setItem(passKey(res.folder.id), pass);
        await loadFolders();
        toast(t('drive.securedSpaceCreated'), 'success');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('common.createFailed'));
      }
      return;
    }

    try {
      await api.post('/folders', { name, isZeroKnowledge: false });
      await loadFolders();
      toast(t('drive.spaceCreated'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.createFailed'));
    }
  }

  async function createFolder() {
    const name = await prompt({ title: t('drive.newFolderTitle'), label: t('drive.folderNameLabel') });
    if (!name) return;
    try {
      await api.post('/folders', { name, parentId: currentFolderId, isZeroKnowledge: isZk });
      await loadFolders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.createFailed'));
    }
  }

  // Create an empty text file and (for normal spaces) open it straight in the editor.
  async function createFileDoc() {
    if (!currentFolderId || needPass) return;
    const name = await prompt({ title: t('drive.newFileTitle'), label: t('drive.newFileLabel'), defaultValue: t('drive.newFileDefault') });
    if (!name) return;
    try {
      if (isZk) {
        if (!vaultKey) return;
        const enc = await encryptFile(vaultKey, new File([''], name, { type: 'text/plain' }));
        const form = new FormData();
        form.append('meta', JSON.stringify({ folderId: currentFolderId, encryptedName: enc.encryptedName, iv: enc.iv, wrappedKey: enc.wrappedKey, encMode: 'ZK' }));
        form.append('file', enc.blob, 'blob');
        await api.upload('/zk/files', form);
        await reloadCurrent();
      } else {
        const form = new FormData();
        form.append('file', new File([''], name, { type: 'text/plain' }));
        const res = await api.upload<{ file?: PublicFile }>(`/files?folderId=${currentFolderId}`, form);
        await reloadCurrent();
        if (res?.file) openFile(res.file);
      }
      toast(t('drive.fileCreated'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('drive.createFileFailed'));
    }
  }

  const onUpload = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list || list.length === 0 || !currentFolderId) return;
      const arr = Array.from(list);
      setError(null);
      try {
        if (isZk) {
          if (!vaultKey) return;
          for (let i = 0; i < arr.length; i += 1) {
            setBusy(t('drive.encrypting', { i: i + 1, n: arr.length }));
            const enc = await encryptFile(vaultKey, arr[i]!);
            const form = new FormData();
            form.append(
              'meta',
              JSON.stringify({
                folderId: currentFolderId,
                encryptedName: enc.encryptedName,
                iv: enc.iv,
                wrappedKey: enc.wrappedKey,
                encMode: 'ZK',
              }),
            );
            form.append('file', enc.blob, 'blob');
            await api.upload('/zk/files', form);
          }
        } else {
          // Server-side upload with a space pre-check and a resilient fallback: a file that won't
          // fit is PAUSED (never attempted) and one that fails mid-flight is handed to the
          // background retry queue — so a big upload survives a hiccup instead of being lost.
          const spaceName = activeSpace?.name ?? '';
          let remaining = user?.quotaBytes != null ? user.quotaBytes - user.usedBytes : Infinity;
          let uploaded = 0;
          for (let i = 0; i < arr.length; i += 1) {
            const f = arr[i]!;
            if (Number.isFinite(remaining) && f.size > remaining) {
              await enqueueForRetry(f, currentFolderId, spaceName, {
                blocked: true,
                error: t('offline.errNoSpacePre', { need: formatBytes(f.size), free: formatBytes(Math.max(0, remaining)) }),
              });
              toast(t('drive.uploadPausedSpace', { name: f.name }), 'info');
              continue;
            }
            setBusy(t('drive.uploading', { i: i + 1, n: arr.length }));
            setProgress(0);
            const form = new FormData();
            form.append('file', f);
            try {
              await api.uploadWithProgress(`/files?folderId=${currentFolderId}`, form, setProgress);
              remaining -= f.size;
              uploaded += 1;
            } catch (err) {
              const status = err instanceof ApiError ? err.status : 0;
              const blocked = status === 413 || status === 507;
              await enqueueForRetry(f, currentFolderId, spaceName, {
                blocked,
                error: err instanceof ApiError ? err.message : t('offline.errNetwork'),
              });
              toast(blocked ? t('drive.uploadPausedSpace', { name: f.name }) : t('drive.uploadQueuedRetry', { name: f.name }), 'info');
            }
          }
          await Promise.all([loadItems(currentFolderId, isZk, vaultKey), refresh()]);
          if (uploaded > 0) {
            toast(uploaded > 1 ? t('drive.filesImportedMany', { n: uploaded }) : t('drive.filesImportedOne', { n: uploaded }), 'success');
          }
          return;
        }
        await Promise.all([loadItems(currentFolderId, isZk, vaultKey), refresh()]);
        toast(arr.length > 1 ? t('drive.filesImportedMany', { n: arr.length }) : t('drive.filesImportedOne', { n: arr.length }), 'success');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('drive.uploadFailed'));
      } finally {
        setBusy(null);
        setProgress(null);
        if (fileInput.current) fileInput.current.value = '';
      }
    },
    [currentFolderId, isZk, vaultKey, loadItems, refresh, t, user, enqueueForRetry, activeSpace],
  );

  // Full-window drag & drop: a drop anywhere over the page uploads into the open folder.
  const dragDepth = useRef(0);
  useEffect(() => {
    if (!activeSpaceId || needPass) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void onUpload(e.dataTransfer?.files ?? null);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [activeSpaceId, needPass, onUpload]);

  // Paste from the OS clipboard: Ctrl/⌘+V with an image or text on the clipboard drops it straight
  // into the open folder. The in-app file clipboard (copy/cut of files) takes precedence and is
  // handled on keydown; this only runs when there's nothing to move internally.
  const onPaste = useCallback(
    async (e: ClipboardEvent) => {
      if (!activeSpaceId || !currentFolderId || needPass || busy || viewing || clipboard) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const dt = e.clipboardData;
      if (!dt) return;

      // A readable timestamp for auto-named pastes (no ':' — invalid in file names).
      const stamp = () => {
        const d = new Date();
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
      };

      // 1) Files / images on the clipboard (screenshots, copied image files).
      const files: File[] = [];
      for (const item of Array.from(dt.items)) {
        if (item.kind !== 'file') continue;
        const f = item.getAsFile();
        if (!f) continue;
        const named = f.name && /\.[a-z0-9]+$/i.test(f.name)
          ? f
          : new File([f], `Image collée ${stamp()}.${(f.type.split('/')[1] || 'png').split('+')[0]}`, { type: f.type || 'image/png' });
        files.push(named);
      }
      if (files.length > 0) {
        e.preventDefault();
        await onUpload(files);
        return;
      }

      // 2) Plain text → a .txt file.
      const text = dt.getData('text/plain');
      if (text && text.trim()) {
        e.preventDefault();
        await onUpload([new File([text], `Texte collé ${stamp()}.txt`, { type: 'text/plain' })]);
      }
    },
    [activeSpaceId, currentFolderId, needPass, busy, viewing, clipboard, onUpload],
  );
  useEffect(() => {
    const h = (e: ClipboardEvent) => void onPaste(e);
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, [onPaste]);

  function openFile(f: PublicFile) {
    setViewing({
      name: f.name,
      mime: f.mimeType,
      sizeBytes: f.sizeBytes,
      url: api.url(`/files/${f.id}/download`),
      onSave: async (text: string) => {
        const form = new FormData();
        form.append('file', new File([text], f.name, { type: f.mimeType || 'text/plain' }));
        await api.upload(`/files?folderId=${f.folderId ?? currentFolderId ?? ''}`, form);
        await reloadCurrent();
      },
    });
  }

  async function decryptZkBlob(f: ZkFile): Promise<Blob | null> {
    if (!vaultKey) return null;
    const res = await fetch(`${API_URL}/zk/files/${f.id}/blob`, { credentials: 'include' });
    return decryptBlob(vaultKey, await res.arrayBuffer(), f.iv, f.wrappedKey);
  }

  function saveBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    signalDownload(name);
  }

  function zkName(f: ZkFile) {
    return f.plainName && !f.plainName.startsWith('🔒') ? f.plainName : t('drive.lockedFileName');
  }

  async function openZk(f: ZkFile) {
    const name = zkName(f);
    try {
      const blob = await decryptZkBlob(f);
      if (!blob) return;
      setViewing({
        name,
        mime: blob.type || undefined,
        sizeBytes: f.sizeBytes,
        blob,
        onDownload: () => saveBlob(blob, name),
        onSave: async (text: string) => {
          if (!vaultKey) return;
          const enc = await encryptFile(vaultKey, new File([text], name, { type: 'text/plain' }));
          const form = new FormData();
          form.append('meta', JSON.stringify({ encryptedName: enc.encryptedName, iv: enc.iv, wrappedKey: enc.wrappedKey }));
          form.append('file', enc.blob, 'blob');
          await api.upload(`/zk/files/${f.id}`, form, 'PUT');
          await reloadCurrent();
        },
      });
    } catch {
      toast(t('drive.decryptFailed'), 'error');
    }
  }

  async function downloadZk(f: ZkFile) {
    const blob = await decryptZkBlob(f);
    if (blob) saveBlob(blob, zkName(f));
  }

  function openEntry(e: Entry) {
    if (e.kind === 'folder') setCurrentFolderId(e.folder.id);
    else if (e.kind === 'file') openFile(e.file);
    else void openZk(e.zk);
  }

  async function reloadCurrent() {
    if (currentFolderId) await Promise.all([loadItems(currentFolderId, isZk, vaultKey), refresh()]);
  }

  // Refresh the open folder when a background (retry) upload lands, so the file appears.
  const reloadCurrentRef = useRef(reloadCurrent);
  reloadCurrentRef.current = reloadCurrent;
  useEffect(() => {
    const h = () => void reloadCurrentRef.current();
    window.addEventListener('ocl:queue-flushed', h);
    return () => window.removeEventListener('ocl:queue-flushed', h);
  }, []);

  // ── Selection ───────────────────────────────────────────────────────────────
  function toggleKey(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Touch long-press selection ───────────────────────────────────────────────
  // Mobile has no right-click / Ctrl-click, so a long-press toggles selection (and, once a
  // selection exists, a plain tap toggles too). `pressHandledAt` both de-dupes the two events
  // a long-press can fire (timer + synthesized contextmenu) and suppresses the click that
  // follows it. `pointerType` lets the mouse handlers stay desktop-standard.
  const pressTimer = useRef<number | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const pointerType = useRef<string>('mouse');
  const pressHandledAt = useRef(0);
  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  function pressSelect(key: string) {
    if (Date.now() - pressHandledAt.current < 700) return; // already handled by the sibling event
    pressHandledAt.current = Date.now();
    navigator.vibrate?.(15);
    toggleKey(key);
    setAnchorKey(key);
  }
  function pressProps(entry: Entry) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        pointerType.current = e.pointerType;
        if (e.pointerType !== 'touch') return;
        pressStart.current = { x: e.clientX, y: e.clientY };
        clearPress();
        pressTimer.current = window.setTimeout(() => {
          clearPress();
          pressSelect(entry.key);
        }, 450);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!pressStart.current || !pressTimer.current) return;
        if (Math.abs(e.clientX - pressStart.current.x) > 10 || Math.abs(e.clientY - pressStart.current.y) > 10) clearPress();
      },
      onPointerUp: clearPress,
      onPointerCancel: clearPress,
      onPointerLeave: clearPress,
    };
  }

  function onEntryClick(e: React.MouseEvent, entry: Entry) {
    if (Date.now() - pressHandledAt.current < 700) return; // click synthesized right after a long-press
    const touch = pointerType.current === 'touch';
    if (touch && selected.size > 0) {
      toggleKey(entry.key);
      setAnchorKey(entry.key);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      toggleKey(entry.key);
      setAnchorKey(entry.key);
    } else if (e.shiftKey) {
      const keys = entries.map((x) => x.key);
      const a = anchorKey ? keys.indexOf(anchorKey) : 0;
      const b = keys.indexOf(entry.key);
      if (a < 0 || b < 0) {
        setSelected(new Set([entry.key]));
      } else {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(keys.slice(lo, hi + 1)));
      }
    } else {
      setSelected(new Set([entry.key]));
      setAnchorKey(entry.key);
    }
  }
  function onNameClick(e: React.MouseEvent, entry: Entry) {
    if (Date.now() - pressHandledAt.current < 700) {
      e.stopPropagation();
      return;
    }
    // In touch selection mode, tapping the name toggles too — let the row handle it.
    if (pointerType.current === 'touch' && selected.size > 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let the row handle selection
    e.stopPropagation();
    openEntry(entry);
  }
  // Grid/mosaic cards have no separate name target, so a plain click OPENS (like clicking the
  // name in list view); modifiers select, long-press / tap-in-selection toggles.
  function onCardClick(e: React.MouseEvent, entry: Entry) {
    if (Date.now() - pressHandledAt.current < 700) return; // click synthesized after a long-press
    if (pointerType.current === 'touch' && selected.size > 0) {
      toggleKey(entry.key);
      setAnchorKey(entry.key);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      onEntryClick(e, entry);
      return;
    }
    openEntry(entry);
  }
  function selectAll() {
    setSelected(new Set(entries.map((e) => e.key)));
  }
  function moveFocus(delta: number) {
    if (entries.length === 0) return;
    const keys = entries.map((e) => e.key);
    let i = anchorKey ? keys.indexOf(anchorKey) : -1;
    i = Math.max(0, Math.min(keys.length - 1, i + delta));
    const k = keys[i]!;
    setSelected(new Set([k]));
    setAnchorKey(k);
  }
  const entriesByKeys = useCallback(
    (keys: string[]) => {
      const set = new Set(keys);
      return entries.filter((e) => set.has(e.key));
    },
    [entries],
  );

  // ── Per-item operations ──────────────────────────────────────────────────────
  async function deleteFolder(id: string) {
    if (!(await confirm({ title: t('drive.deleteFolderTitle'), message: t('drive.deleteFolderMsg'), confirmLabel: t('drive.deleteToTrash') }))) return;
    await api.del(`/folders/${id}`);
    await Promise.all([loadFolders(), refresh()]);
    toast(t('drive.movedToTrash'), 'success');
  }
  async function deleteFile(id: string) {
    if (!(await confirm({ title: t('drive.deleteFileTitle'), confirmLabel: t('drive.deleteToTrash') }))) return;
    await api.del(isZk ? `/zk/files/${id}` : `/files/${id}`);
    await reloadCurrent();
    toast(t('drive.movedToTrash'), 'success');
  }
  async function deleteSpace(space: PublicFolder) {
    const typed = await prompt({
      title: t('drive.deleteSpaceTitle'),
      message: t('drive.deleteSpaceMsg', { name: space.name }),
      label: t('drive.deleteSpaceLabel', { name: space.name }),
      placeholder: space.name,
      confirmLabel: t('drive.deleteSpaceConfirm'),
    });
    if (typed === null) return;
    if (typed.trim() !== space.name) {
      toast(t('drive.deleteSpaceMismatch'), 'error');
      return;
    }
    try {
      await api.del(`/folders/${space.id}`);
      await Promise.all([loadFolders(), refresh()]);
      toast(t('drive.movedToTrash'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.opFailed'));
    }
  }
  async function renameFile(f: PublicFile) {
    const name = await prompt({ title: t('drive.renameTitle'), label: t('drive.renameLabel'), defaultValue: f.name });
    if (!name || name === f.name) return;
    await api.patch(`/files/${f.id}`, { name });
    await reloadCurrent();
  }
  async function renameFolder(f: PublicFolder) {
    const name = await prompt({ title: t('drive.renameFolderTitle'), label: t('drive.renameLabel'), defaultValue: f.name });
    if (!name || name === f.name) return;
    await api.patch(`/folders/${f.id}`, { name });
    await loadFolders();
  }
  function renameByKey(key: string) {
    const entry = entries.find((e) => e.key === key);
    if (!entry) return;
    if (entry.kind === 'folder') void renameFolder(entry.folder);
    else if (entry.kind === 'file') void renameFile(entry.file);
  }
  async function move(kind: 'file' | 'folder', id: string) {
    const targets = [
      { id: null as string | null, name: t('drive.spaceRoot') },
      ...allFolders.filter((f) => f.id !== id && f.isZeroKnowledge === isZk),
    ];
    const dest = await choose<string | '__root__'>({
      title: t('drive.moveTitle'),
      options: targets.map((tg) => ({ value: tg.id ?? '__root__', label: tg.name })),
    });
    if (dest === null) return;
    const target = dest === '__root__' ? null : dest;
    await api.patch(`/${kind}s/${id}`, { folderId: target, parentId: target });
    await Promise.all([loadFolders(), reloadCurrent()]);
    toast(t('drive.moved'), 'success');
  }
  async function share(kind: 'file' | 'folder', id: string) {
    const accessMode = await choose<'PUBLIC' | 'CODE' | 'AUTHENTICATED'>({
      title: t('drive.shareTitle'),
      message: t('drive.shareMsg'),
      options: [
        { value: 'PUBLIC', label: t('drive.shareEveryone'), description: t('drive.shareEveryoneDesc') },
        { value: 'CODE', label: t('drive.shareCode'), description: t('drive.shareCodeDesc') },
        { value: 'AUTHENTICATED', label: t('drive.shareAuth'), description: t('drive.shareAuthDesc') },
      ],
    });
    if (!accessMode) return;
    const viewType = await choose<'PAGE' | 'RAW'>({
      title: t('drive.linkTypeTitle'),
      options: [
        { value: 'PAGE', label: t('drive.linkTypePage'), description: t('drive.linkTypePageDesc') },
        { value: 'RAW', label: t('drive.linkTypeRaw'), description: t('drive.linkTypeRawDesc') },
      ],
    });
    if (!viewType) return;
    let code: string | undefined;
    if (accessMode === 'CODE') {
      const entered = await prompt({ title: t('drive.accessCodeTitle'), label: t('drive.accessCodeLabel'), password: true });
      if (!entered || entered.length < 4) {
        toast(t('drive.codeTooShort'), 'error');
        return;
      }
      code = entered;
    }
    try {
      const body = kind === 'file' ? { fileId: id } : { folderId: id };
      const res = await api.post<{ share: { token: string } }>('/shares', { ...body, accessMode, viewType, code });
      const link = `${window.location.origin}/s/${res.share.token}`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      setShareLink(link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('drive.shareFailed'));
    }
  }
  // ── Bulk actions ─────────────────────────────────────────────────────────────
  async function bulkDelete() {
    const items = entriesByKeys([...selected]);
    if (items.length === 0) return;
    if (!(await confirm({ title: t('drive.bulkDeleteTitle', { n: items.length }), confirmLabel: t('drive.deleteToTrash'), danger: true }))) return;
    for (const it of items) {
      if (it.kind === 'folder') await api.del(`/folders/${it.folder.id}`);
      else if (it.kind === 'file') await api.del(`/files/${it.file.id}`);
      else await api.del(`/zk/files/${it.zk.id}`);
    }
    setSelected(new Set());
    await Promise.all([loadFolders(), reloadCurrent()]);
    toast(t('drive.bulkDeleted', { n: items.length }), 'success');
  }
  async function bulkDownload() {
    const items = entriesByKeys([...selected]).filter((e) => e.kind !== 'folder');
    if (items.length === 0) return;
    // Several files at once → one .zip (browsers block a burst of separate downloads);
    // a single file downloads directly.
    if (items.length > 1) {
      await zipSelection();
      return;
    }
    const it = items[0]!;
    if (it.kind === 'file') {
      const a = document.createElement('a');
      a.href = api.url(`/files/${it.file.id}/download`);
      a.download = it.file.name;
      a.click();
      signalDownload(it.file.name);
    } else if (it.kind === 'zk') {
      const blob = await decryptZkBlob(it.zk);
      if (blob) saveBlob(blob, zkName(it.zk));
    }
  }
  async function bulkMove() {
    const items = entriesByKeys([...selected]).filter((e) => e.kind !== 'zk');
    if (items.length === 0) return;
    const selfIds = new Set(items.map((e) => (e.kind === 'folder' ? e.folder.id : '')));
    const targets = [
      { id: null as string | null, name: t('drive.spaceRoot') },
      ...allFolders.filter((f) => f.isZeroKnowledge === isZk && !selfIds.has(f.id)),
    ];
    const dest = await choose<string | '__root__'>({
      title: t('drive.moveTitle'),
      options: targets.map((tg) => ({ value: tg.id ?? '__root__', label: tg.name })),
    });
    if (dest === null) return;
    const target = dest === '__root__' ? null : dest;
    for (const it of items) {
      if (it.kind === 'folder') await api.patch(`/folders/${it.folder.id}`, { parentId: target });
      else if (it.kind === 'file') await api.patch(`/files/${it.file.id}`, { folderId: target });
    }
    setSelected(new Set());
    await Promise.all([loadFolders(), reloadCurrent()]);
    toast(t('drive.bulkMoved', { n: items.length }), 'success');
  }

  // ── Clipboard (normal spaces only) ───────────────────────────────────────────
  function copyName(name: string) {
    const suffix = ` ${t('drive.copySuffix')}`;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
  }
  function buildClip(op: 'copy' | 'cut') {
    if (isZk) return;
    const items: ClipItem[] = entriesByKeys([...selected])
      .filter((e) => e.kind !== 'zk')
      .map((e) =>
        e.kind === 'folder'
          ? { kind: 'folder', id: e.folder.id, name: e.folder.name, sourceFolderId: e.folder.parentId }
          : { kind: 'file', id: e.file.id, name: e.file.name, mimeType: e.file.mimeType, sourceFolderId: e.file.folderId },
      );
    if (items.length === 0) return;
    setClipboard({ op, items });
    toast(op === 'copy' ? t('drive.copied', { n: items.length }) : t('drive.cutReady', { n: items.length }), 'info');
  }
  async function duplicateFile(id: string, name: string, mime: string | undefined, targetFolderId: string, rename: boolean) {
    const res = await fetch(api.url(`/files/${id}/download`), { credentials: 'include' });
    const blob = await res.blob();
    const form = new FormData();
    form.append('file', new File([blob], rename ? copyName(name) : name, { type: mime || 'application/octet-stream' }));
    await api.upload(`/files?folderId=${targetFolderId}`, form);
  }
  async function paste() {
    if (isZk || !clipboard || !currentFolderId) return;
    setBusy(t('drive.pasted'));
    try {
      let hadFolder = false;
      for (const it of clipboard.items) {
        if (clipboard.op === 'cut') {
          if (it.kind === 'folder') await api.patch(`/folders/${it.id}`, { parentId: currentFolderId });
          else await api.patch(`/files/${it.id}`, { folderId: currentFolderId });
        } else if (it.kind === 'folder') {
          hadFolder = true;
        } else {
          await duplicateFile(it.id, it.name, it.mimeType, currentFolderId, it.sourceFolderId === currentFolderId);
        }
      }
      if (clipboard.op === 'cut') setClipboard(null);
      await Promise.all([loadFolders(), reloadCurrent()]);
      if (hadFolder) toast(t('drive.pasteFolderUnsupported'), 'info');
      else toast(t('drive.pasted'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.opFailed'));
    } finally {
      setBusy(null);
    }
  }
  async function duplicateSelection() {
    if (isZk || !currentFolderId) return;
    const items = entriesByKeys([...selected]).filter((e): e is Extract<Entry, { kind: 'file' }> => e.kind === 'file');
    if (items.length === 0) return;
    setBusy(t('drive.actionDuplicate'));
    try {
      for (const it of items) await duplicateFile(it.file.id, it.file.name, it.file.mimeType, currentFolderId, true);
      await reloadCurrent();
      toast(t('drive.pasted'), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.opFailed'));
    } finally {
      setBusy(null);
    }
  }

  // ── Zip / unzip (client-side, so it works for vault files too) ───────────────
  function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
    return new Promise((resolve, reject) => fzip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))));
  }
  function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
    return new Promise((resolve, reject) => funzip(data, (err, files) => (err ? reject(err) : resolve(files))));
  }
  // fflate yields Uint8Array<ArrayBufferLike>; Blob/File want a plain BlobPart. The bytes are
  // always ArrayBuffer-backed, so this coercion is safe.
  const asPart = (u: Uint8Array): BlobPart => u as unknown as BlobPart;
  function isZip(name: string, mime?: string) {
    return name.toLowerCase().endsWith('.zip') || mime === 'application/zip' || mime === 'application/x-zip-compressed';
  }
  // Decrypt/fetch a single file's raw bytes (folders return null).
  async function entryBytes(e: Entry): Promise<{ name: string; data: Uint8Array } | null> {
    if (e.kind === 'file') {
      const res = await fetch(api.url(`/files/${e.file.id}/download`), { credentials: 'include' });
      return { name: e.file.name, data: new Uint8Array(await res.arrayBuffer()) };
    }
    if (e.kind === 'zk') {
      const blob = await decryptZkBlob(e.zk);
      return blob ? { name: zkName(e.zk), data: new Uint8Array(await blob.arrayBuffer()) } : null;
    }
    return null;
  }
  async function uploadBytes(name: string, data: Uint8Array, folderId: string) {
    if (isZk) {
      if (!vaultKey) return;
      const enc = await encryptFile(vaultKey, new File([asPart(data)], name));
      const form = new FormData();
      form.append('meta', JSON.stringify({ folderId, encryptedName: enc.encryptedName, iv: enc.iv, wrappedKey: enc.wrappedKey, encMode: 'ZK' }));
      form.append('file', enc.blob, 'blob');
      await api.upload('/zk/files', form);
    } else {
      const form = new FormData();
      form.append('file', new File([asPart(data)], name));
      await api.upload(`/files?folderId=${folderId}`, form);
    }
  }
  // Compress the selected files into a single .zip download.
  async function zipSelection() {
    const items = entriesByKeys([...selected]).filter((e) => e.kind !== 'folder');
    if (items.length === 0) return;
    setBusy(t('drive.zipping'));
    try {
      const files: Record<string, Uint8Array> = {};
      for (const e of items) {
        const b = await entryBytes(e);
        if (!b) continue;
        let name = b.name;
        for (let i = 1; files[name]; i += 1) {
          const dot = b.name.lastIndexOf('.');
          name = dot > 0 ? `${b.name.slice(0, dot)} (${i})${b.name.slice(dot)}` : `${b.name} (${i})`;
        }
        files[name] = b.data;
      }
      saveBlob(new Blob([asPart(await zipAsync(files))], { type: 'application/zip' }), `${activeSpace?.name ?? 'archive'}.zip`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('drive.zipFailed'));
    } finally {
      setBusy(null);
    }
  }
  // Extract a .zip into the current folder, recreating its sub-folders.
  async function extractZip(e: Entry) {
    if (!currentFolderId) return;
    setBusy(t('drive.extracting'));
    try {
      const archive = await entryBytes(e);
      if (!archive) return;
      const entries = await unzipAsync(archive.data);
      // Cache folder paths → id so each directory is created once.
      const folderIds = new Map<string, string>([['', currentFolderId]]);
      const ensurePath = async (dirs: string[]): Promise<string> => {
        let key = '';
        let parent = currentFolderId!;
        for (const d of dirs) {
          const next = key ? `${key}/${d}` : d;
          if (!folderIds.has(next)) {
            const res = await api.post<{ folder: { id: string } }>('/folders', { name: d, parentId: parent, isZeroKnowledge: isZk });
            folderIds.set(next, res.folder.id);
          }
          parent = folderIds.get(next)!;
          key = next;
        }
        return parent;
      };
      let count = 0;
      for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith('/') || data.length === 0) continue; // directory entry
        const parts = path.split('/').filter(Boolean);
        const name = parts.pop()!;
        const folderId = await ensurePath(parts);
        await uploadBytes(name, data, folderId);
        count += 1;
      }
      await Promise.all([loadFolders(), reloadCurrent()]);
      toast(t('drive.extracted', { n: count }), 'success');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('drive.extractFailed'));
    } finally {
      setBusy(null);
    }
  }

  // ── Menu items (shared by the "⋮" overflow menu and the right-click context menu) ──
  function folderMenuItems(folder: PublicFolder): MenuItem[] {
    return [
      { label: t('drive.actionRename'), icon: Pencil, onClick: () => void renameFolder(folder) },
      ...(!isZk ? [{ label: t('drive.actionMove'), icon: FolderInput, onClick: () => void move('folder', folder.id) }] : []),
      ...(!isZk ? [{ label: t('drive.actionShare'), icon: Share2, onClick: () => void share('folder', folder.id) }] : []),
      { label: t('drive.actionDelete'), icon: Trash2, danger: true, onClick: () => void deleteFolder(folder.id) },
    ];
  }
  function fileMenuItems(file: PublicFile): MenuItem[] {
    if (isPublic) {
      // Public/Open space: the point is the direct URL, so lead with it. No versions (media isn't
      // versioned); ZK-only features don't apply.
      return [
        { label: t('drive.copyPublicUrl'), icon: Link2, onClick: () => void copyPublicUrl(file) },
        { label: t('drive.openPublicUrl'), icon: Eye, onClick: () => window.open(publicUrl(file), '_blank') },
        { label: t('drive.actionRename'), icon: Pencil, onClick: () => void renameFile(file) },
        { label: t('drive.actionMove'), icon: FolderInput, onClick: () => void move('file', file.id) },
        { label: t('drive.actionDelete'), icon: Trash2, danger: true, onClick: () => void deleteFile(file.id) },
      ];
    }
    return [
      { label: t('drive.actionRename'), icon: Pencil, onClick: () => void renameFile(file) },
      { label: t('drive.actionMove'), icon: FolderInput, onClick: () => void move('file', file.id) },
      { label: t('drive.actionDuplicate'), icon: Files, onClick: () => void duplicateFile(file.id, file.name, file.mimeType, currentFolderId!, true).then(reloadCurrent) },
      ...(isZip(file.name, file.mimeType)
        ? [{ label: t('drive.actionExtract'), icon: PackageOpen, onClick: () => void extractZip({ key: `file:${file.id}`, kind: 'file', name: file.name, size: file.sizeBytes, date: 0, file }) }]
        : []),
      { label: t('drive.actionShare'), icon: Share2, onClick: () => void share('file', file.id) },
      { label: t('drive.actionVersions'), icon: History, onClick: () => setVersionsFor(file) },
      { label: t('drive.actionDelete'), icon: Trash2, danger: true, onClick: () => void deleteFile(file.id) },
    ];
  }
  function zkMenuItems(zk: ZkFile): MenuItem[] {
    return [
      ...(isZip(zkName(zk))
        ? [{ label: t('drive.actionExtract'), icon: PackageOpen, onClick: () => void extractZip({ key: `zk:${zk.id}`, kind: 'zk', name: zkName(zk), size: zk.sizeBytes, date: 0, zk }) }]
        : []),
      { label: t('drive.actionDelete'), icon: Trash2, danger: true, onClick: () => void deleteFile(zk.id) },
    ];
  }
  function entryMenuItems(e: Entry): MenuItem[] {
    return e.kind === 'folder' ? folderMenuItems(e.folder) : e.kind === 'file' ? fileMenuItems(e.file) : zkMenuItems(e.zk);
  }
  function bulkMenuItems(): MenuItem[] {
    const items: MenuItem[] = [
      { label: t('drive.bulkDownload'), icon: Download, onClick: () => void bulkDownload() },
      { label: t('drive.zipDownload'), icon: Archive, onClick: () => void zipSelection() },
    ];
    if (!isZk) {
      items.push({ label: t('drive.actionCopy'), icon: Copy, onClick: () => buildClip('copy') });
      items.push({ label: t('drive.actionCut'), icon: Scissors, onClick: () => buildClip('cut') });
      items.push({ label: t('drive.bulkMove'), icon: FolderInput, onClick: () => void bulkMove() });
    }
    items.push({ label: t('drive.bulkDelete'), icon: Trash2, danger: true, onClick: () => void bulkDelete() });
    return items;
  }
  function backgroundMenuItems(): MenuItem[] {
    const items: MenuItem[] = [
      { label: t('drive.cmdNewFile'), icon: FilePlus, onClick: () => void createFileDoc() },
      { label: t('drive.cmdNewFolder'), icon: FolderPlus, onClick: () => void createFolder() },
      { label: t('drive.cmdImport'), icon: Upload, onClick: () => fileInput.current?.click() },
    ];
    if (!isZk && clipboard) items.push({ label: t('drive.scPaste'), icon: ClipboardPaste, onClick: () => void paste() });
    if (entries.length > 0) items.push({ label: t('drive.scSelectAll'), icon: Check, onClick: () => selectAll() });
    return items;
  }
  function openCtx(ev: React.MouseEvent, items: MenuItem[]) {
    ev.preventDefault();
    ev.stopPropagation();
    if (items.length > 0) setCtxMenu({ x: ev.clientX, y: ev.clientY, items });
  }
  function onEntryContext(ev: React.MouseEvent, e: Entry) {
    // On touch, a long-press fires `contextmenu` — treat it as select, not a desktop menu.
    if (pointerType.current === 'touch') {
      ev.preventDefault();
      pressSelect(e.key);
      return;
    }
    // Right-click on something inside a multi-selection → bulk menu; otherwise act on the
    // clicked entry WITHOUT changing the current selection (the menu targets it directly).
    if (selected.has(e.key) && selected.size > 1) {
      openCtx(ev, bulkMenuItems());
      return;
    }
    openCtx(ev, entryMenuItems(e));
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  // A ref keeps the latest handler so we register the window listener only once.
  const keyHandler = (e: KeyboardEvent) => {
    if (paletteOpen || helpOpen || viewing || askPass || shareLink || versionsFor || ctxMenu) return;
    if (document.querySelector('[class*="z-[100]"]')) return; // an in-app dialog is open
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen(true);
      return;
    }
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (!activeSpaceId) return;
    if (e.key === '?') {
      e.preventDefault();
      setHelpOpen(true);
      return;
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      buildClip('copy');
      return;
    }
    if (mod && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      buildClip('cut');
      return;
    }
    if (mod && e.key.toLowerCase() === 'v') {
      // Internal file clipboard (copy/cut) wins; otherwise let the native `paste` event handle an
      // image/text sitting on the OS clipboard (see the onPaste handler).
      if (clipboard) {
        e.preventDefault();
        void paste();
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      void duplicateSelection();
      return;
    }
    // Escape = step back: drop the selection first, otherwise go up one level (or leave the space).
    if (e.key === 'Escape') {
      e.preventDefault();
      if (selected.size > 0) setSelected(new Set());
      else goParent();
      return;
    }
    if (needPass) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.altKey) goParent();
        else moveFocus(-1);
        break;
      case 'Enter':
        if (anchorKey) {
          e.preventDefault();
          const entry = entries.find((x) => x.key === anchorKey);
          if (entry) openEntry(entry);
        }
        break;
      case 'Backspace':
        e.preventDefault();
        goParent();
        break;
      case 'Delete':
        e.preventDefault();
        void bulkDelete();
        break;
      case 'F2':
        if (selected.size === 1) {
          e.preventDefault();
          renameByKey([...selected][0]!);
        }
        break;
      default:
        break;
    }
  };
  const keyHandlerRef = useRef(keyHandler);
  keyHandlerRef.current = keyHandler;
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Command palette items ─────────────────────────────────────────────────────
  const close = () => setPaletteOpen(false);
  const paletteItems: PaletteItem[] = [];
  if (activeSpaceId && !needPass) {
    paletteItems.push({ id: 'cmd-newfile', kind: 'command', label: t('drive.cmdNewFile'), icon: FilePlus, run: () => { close(); void createFileDoc(); } });
    paletteItems.push({ id: 'cmd-newfolder', kind: 'command', label: t('drive.cmdNewFolder'), icon: FolderPlus, run: () => { close(); void createFolder(); } });
    paletteItems.push({ id: 'cmd-import', kind: 'command', label: t('drive.cmdImport'), icon: Upload, run: () => { close(); fileInput.current?.click(); } });
    paletteItems.push({ id: 'cmd-view', kind: 'command', label: t('drive.cmdToggleView'), icon: LayoutGrid, run: () => { close(); setView((v) => (v === 'grid' ? 'list' : 'grid')); } });
  }
  paletteItems.push({ id: 'cmd-help', kind: 'command', label: t('drive.cmdHelp'), icon: Keyboard, run: () => { close(); setHelpOpen(true); } });
  if (activeSpaceId) paletteItems.push({ id: 'cmd-spaces', kind: 'command', label: t('drive.cmdGoSpaces'), icon: Home, run: () => { close(); leaveSpace(); } });
  // Zero-Knowledge spaces/folders and their files are intentionally excluded: their names are
  // encrypted and opening them needs the vault passphrase, so the palette never points into them.
  for (const f of allFolders) {
    if (f.isZeroKnowledge) continue;
    paletteItems.push({
      id: `f-${f.id}`,
      kind: 'folder',
      label: f.name,
      sub: f.parentId === null ? t('drive.normalSpace') : undefined,
      icon: Folder,
      run: () => { close(); jumpToFolder(f); },
    });
  }
  if (!isZk) {
    for (const e of entries) {
      if (e.kind === 'file') paletteItems.push({ id: `x-${e.file.id}`, kind: 'file', label: e.file.name, icon: fileVisual(e.file.name, e.file.mimeType).Icon, run: () => { close(); openFile(e.file); } });
    }
  }

  // Global file lookup for the palette — normal (non-vault) files only, across the account.
  async function searchFiles(query: string): Promise<PaletteItem[]> {
    try {
      const res = await api.get<{ files: PublicFile[] }>(`/files/search?q=${encodeURIComponent(query)}`);
      return res.files.map((f) => ({
        id: `search-${f.id}`,
        kind: 'file' as const,
        label: f.name,
        sub: t('drive.searchInFiles'),
        icon: fileVisual(f.name, f.mimeType).Icon,
        run: () => {
          setPaletteOpen(false);
          openFile(f);
        },
      }));
    } catch {
      return [];
    }
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  async function pickSort() {
    const key = await choose<SortKey>({
      title: t('drive.sortBy'),
      options: [
        { value: 'name', label: t('drive.colName') },
        { value: 'size', label: t('drive.colSize') },
        { value: 'date', label: t('drive.colModified') },
      ],
    });
    if (key) toggleSort(key);
  }
  function SortCaret({ k }: { k: SortKey }) {
    if (sort.key !== k) return null;
    return sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Offline: swap the whole Drive for the minimal "queue an upload" view.
  if (!online) {
    return <OfflineView />;
  }

  if (!activeSpaceId) {
    return (
      <div className="space-y-6">
        <Header title={t('drive.title')} subtitle={t('drive.subtitle')}>
          <button className="btn-primary" onClick={createSpace}>
            <Plus size={16} /> {t('drive.newSpace')}
          </button>
        </Header>
        {error && <ErrorLine msg={error} />}
        {spaces.length === 0 ? (
          <Empty icon={FolderLock} title={t('drive.noSpacesTitle')} hint={t('drive.noSpacesHint')} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((s) => (
              <div
                key={s.id}
                className="card group relative flex items-center gap-4 text-left transition hover:border-accent/40 hover:bg-white/[0.04]"
              >
                <button onClick={() => enterSpace(s)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <span
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                      s.isZeroKnowledge
                        ? 'bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-violet-200'
                        : s.isPublic
                          ? 'bg-gradient-to-br from-sky-500/25 to-emerald-500/15 text-sky-200'
                          : 'bg-white/[0.05] text-zinc-300'
                    }`}
                  >
                    {s.isZeroKnowledge ? <ShieldCheck size={22} /> : s.isPublic ? <Globe size={22} /> : <Folder size={22} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-100">{s.name}</p>
                    <p className="text-xs text-zinc-500">
                      {s.isZeroKnowledge ? t('drive.secured') : s.isPublic ? t('drive.publicSpace') : t('drive.normalSpace')}
                    </p>
                  </div>
                </button>
                <div className="shrink-0">
                  <Menu items={[{ label: t('drive.deleteSpaceAction'), icon: Trash2, danger: true, onClick: () => deleteSpace(s) }]} />
                </div>
              </div>
            ))}
          </div>
        )}
        {paletteOpen && <CommandPalette items={paletteItems} onSearch={searchFiles} onClose={() => setPaletteOpen(false)} />}
        {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
        {viewing && <FileViewer source={viewing} onClose={() => setViewing(null)} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* breadcrumb */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-500">
        <button className="flex items-center gap-1 hover:text-zinc-200" onClick={leaveSpace}>
          <Home size={15} /> {t('drive.spaces')}
        </button>
        {breadcrumb.map((f, i) => (
          <span key={f.id} className="flex items-center gap-1.5">
            <ChevronRight size={14} />
            <button
              className={`hover:text-zinc-200 ${i === breadcrumb.length - 1 ? 'text-zinc-200' : ''}`}
              onClick={() => setCurrentFolderId(f.id)}
            >
              {f.name}
            </button>
          </span>
        ))}
      </div>

      {isPublic && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2 text-sm text-sky-200">
          <Globe size={16} className="mt-0.5 shrink-0" />
          <span>{t('drive.publicBanner')}</span>
        </div>
      )}

      <Header
        title={activeSpace?.name ?? ''}
        subtitle={isZk ? t('drive.securedFolder') : isPublic ? t('drive.publicSpace') : t('drive.normalFolder')}
        badge={isZk ? 'secured' : undefined}
        badgeLabel={t('drive.securedBadge')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
            <ViewBtn active={view === 'list'} onClick={() => setView('list')} icon={ListIcon} />
            <ViewBtn active={view === 'grid'} onClick={() => setView('grid')} icon={LayoutGrid} />
          </div>
          <button className="btn-ghost" onClick={pickSort} title={t('drive.sortBy')}>
            <ArrowDownUp size={16} />
          </button>
          {!isZk && clipboard && (
            <button className="btn-ghost" onClick={() => void paste()} disabled={needPass || !!busy}>
              <ClipboardPaste size={16} /> {t('drive.scPaste')}
            </button>
          )}
          <button className="btn-ghost" onClick={createFolder} disabled={needPass}>
            <FolderPlus size={16} /> {t('drive.folder')}
          </button>
          <button className="btn-ghost" onClick={createFileDoc} disabled={needPass}>
            <FilePlus size={16} /> {t('drive.newFile')}
          </button>
          <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={needPass || !!busy}>
            <Upload size={16} /> {busy ?? t('drive.import')}
          </button>
          <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
        </div>
      </Header>

      {error && <ErrorLine msg={error} />}

      {/* Selection toolbar */}
      {selected.size > 0 && !needPass && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/[0.06] px-3 py-2 text-sm">
          <span className="font-medium text-zinc-100">{t('drive.selectedCount', { n: selected.size })}</span>
          <div className="flex-1" />
          <BulkBtn icon={Download} label={t('drive.bulkDownload')} onClick={() => void bulkDownload()} />
          <BulkBtn icon={Archive} label={t('drive.zipDownload')} onClick={() => void zipSelection()} />
          {!isZk && <BulkBtn icon={Copy} label={t('drive.actionCopy')} onClick={() => buildClip('copy')} />}
          {!isZk && <BulkBtn icon={Scissors} label={t('drive.actionCut')} onClick={() => buildClip('cut')} />}
          {!isZk && <BulkBtn icon={FolderInput} label={t('drive.bulkMove')} onClick={() => void bulkMove()} />}
          <BulkBtn icon={Trash2} label={t('drive.bulkDelete')} danger onClick={() => void bulkDelete()} />
          <BulkBtn icon={X} label={t('drive.clearSelection')} onClick={() => setSelected(new Set())} />
        </div>
      )}

      {progress !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {needPass ? (
        <Empty icon={KeyRound} title={t('drive.lockedTitle')} hint={t('drive.lockedHint')}>
          <button className="btn-primary" onClick={() => setAskPass(activeSpace)}>
            <Lock size={16} /> {t('drive.unlock')}
          </button>
        </Empty>
      ) : entries.length === 0 ? (
        <Empty icon={Upload} title={t('drive.emptyFolderTitle')} hint={t('drive.emptyFolderHint')} />
      ) : view === 'grid' ? (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
          onContextMenu={(ev) => !needPass && openCtx(ev, backgroundMenuItems())}
        >
          {entries.map((e) => (
            <GridCard
              key={e.key}
              selected={selected.has(e.key)}
              iconNode={cardIcon(e, isZk)}
              name={e.name}
              sub={e.kind === 'folder' ? undefined : formatBytes(e.size)}
              onClick={(ev) => onCardClick(ev, e)}
              onDoubleClick={() => openEntry(e)}
              onContextMenu={(ev) => onEntryContext(ev, e)}
              press={pressProps(e)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2" onContextMenu={(ev) => !needPass && openCtx(ev, backgroundMenuItems())}>
          {/* column headers */}
          <div className="flex items-center gap-3 px-3 text-xs text-zinc-500">
            <button className="flex items-center gap-1 hover:text-zinc-300" onClick={() => toggleSort('name')}>
              {t('drive.colName')} <SortCaret k="name" />
            </button>
            <div className="flex-1" />
            <button className="hidden items-center gap-1 hover:text-zinc-300 sm:flex" onClick={() => toggleSort('date')}>
              {t('drive.colModified')} <SortCaret k="date" />
            </button>
            <button className="flex w-20 items-center justify-end gap-1 hover:text-zinc-300" onClick={() => toggleSort('size')}>
              {t('drive.colSize')} <SortCaret k="size" />
            </button>
            <span className="w-[88px]" />
          </div>

          {entries.map((e) => (
            <div
              key={e.key}
              onClick={(ev) => onEntryClick(ev, e)}
              onDoubleClick={() => openEntry(e)}
              onContextMenu={(ev) => onEntryContext(ev, e)}
              {...pressProps(e)}
              className={`row cursor-default ${selected.has(e.key) ? 'bg-accent/[0.08] ring-1 ring-inset ring-accent/40' : ''}`}
            >
              <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={(ev) => onNameClick(ev, e)}>
                {rowIcon(e, isZk)}
                <span className="truncate font-medium text-zinc-100">{e.name}</span>
              </button>
              <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">{new Date(e.date).toLocaleDateString()}</span>
              <span className="w-20 shrink-0 text-right text-xs text-zinc-500">{e.kind === 'folder' ? '—' : formatBytes(e.size)}</span>
              <div className="flex shrink-0 items-center gap-0.5" onClick={(ev) => ev.stopPropagation()}>
                {e.kind === 'folder' ? (
                  <Menu items={folderMenuItems(e.folder)} />
                ) : e.kind === 'file' ? (
                  <>
                    <IconBtn title={t('drive.open')} icon={Eye} onClick={() => openFile(e.file)} />
                    <a className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100" title={t('drive.actionDownload')} href={api.url(`/files/${e.file.id}/download`)} onClick={() => signalDownload(e.file.name)}>
                      <Download size={16} />
                    </a>
                    <Menu items={fileMenuItems(e.file)} />
                  </>
                ) : (
                  <>
                    <IconBtn title={t('drive.open')} icon={Eye} onClick={() => openZk(e.zk)} />
                    <IconBtn title={t('drive.actionDownload')} icon={Download} onClick={() => downloadZk(e.zk)} />
                    <Menu items={zkMenuItems(e.zk)} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Passphrase modal */}
      {askPass && (
        <Modal onClose={() => setAskPass(null)}>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-violet-300">
                <KeyRound size={20} />
              </span>
              <div>
                <h3 className="font-semibold text-zinc-100">{t('drive.securedSpace')}</h3>
                <p className="text-xs text-zinc-500">{askPass.name}</p>
              </div>
            </div>
            <p className="text-sm text-zinc-400">{t('drive.passphraseExplain')}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitPassphrase();
              }}
              className="space-y-3"
            >
              <input
                className="input"
                type="password"
                autoFocus
                placeholder={t('drive.passphrasePlaceholder')}
                value={passInput}
                onChange={(e) => {
                  setPassInput(e.target.value);
                  if (passError) setPassError(null);
                }}
              />
              {passError && <p className="text-sm text-red-300">{passError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => { setAskPass(null); setPassError(null); }}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-primary" disabled={!passInput}>
                  {t('drive.unlock')}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {shareLink && <ShareLinkModal link={shareLink} onClose={() => setShareLink(null)} />}
      {versionsFor && (
        <VersionHistory
          file={{ id: versionsFor.id, name: versionsFor.name, mimeType: versionsFor.mimeType }}
          onClose={() => setVersionsFor(null)}
          onRestored={reloadCurrent}
        />
      )}
      {paletteOpen && <CommandPalette items={paletteItems} onSearch={searchFiles} onClose={() => setPaletteOpen(false)} />}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {viewing && <FileViewer source={viewing} onClose={() => setViewing(null)} />}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      <DropOverlay show={dragging} />
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────

function cardIcon(e: Entry, isZk: boolean) {
  if (e.kind === 'folder') return isZk ? <FolderLock size={30} className="text-violet-300" /> : <Folder size={30} className="text-zinc-400" />;
  if (e.kind === 'zk') return <Lock size={30} className="text-violet-300" />;
  const v = fileVisual(e.file.name, e.file.mimeType);
  return <v.Icon size={30} className={v.color} />;
}
function rowIcon(e: Entry, isZk: boolean) {
  if (e.kind === 'folder') return isZk ? <FolderLock size={18} className="text-violet-300" /> : <Folder size={18} className="text-zinc-400" />;
  if (e.kind === 'zk')
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-300">
        <Lock size={16} />
      </span>
    );
  const v = fileVisual(e.file.name, e.file.mimeType);
  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${v.bg} ${v.color}`}>
      <v.Icon size={16} />
    </span>
  );
}

function Header({
  title,
  subtitle,
  badge,
  badgeLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: 'secured';
  badgeLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          {badge === 'secured' && (
            <span className="chip bg-accent-soft text-violet-300">
              <ShieldCheck size={12} /> {badgeLabel}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ViewBtn({ active, onClick, icon: Icon }: { active: boolean; onClick: () => void; icon: typeof ListIcon }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md p-1.5 transition ${active ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
    >
      <Icon size={16} />
    </button>
  );
}

function BulkBtn({ icon: Icon, label, onClick, danger }: { icon: typeof Pencil; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition hover:bg-white/10 ${danger ? 'text-red-300' : 'text-zinc-300'}`}
    >
      <Icon size={14} /> {label}
    </button>
  );
}

function IconBtn({ icon: Icon, title, onClick, danger }: { icon: typeof Pencil; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition hover:bg-white/5 ${danger ? 'text-zinc-400 hover:text-red-300' : 'text-zinc-400 hover:text-zinc-100'}`}
    >
      <Icon size={16} />
    </button>
  );
}

function GridCard({
  iconNode,
  name,
  sub,
  selected,
  onClick,
  onDoubleClick,
  onContextMenu,
  press,
}: {
  iconNode: React.ReactNode;
  name: string;
  sub?: string;
  selected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  press?: React.DOMAttributes<HTMLDivElement>;
}) {
  return (
    <div
      {...press}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`card flex cursor-default select-none flex-col items-center gap-2 py-5 text-center transition hover:border-white/15 hover:bg-white/[0.04] ${
        selected ? 'bg-accent/[0.08] ring-1 ring-inset ring-accent/40' : ''
      }`}
    >
      {iconNode}
      <span className="line-clamp-2 w-full break-words text-sm font-medium text-zinc-100">{name}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </div>
  );
}

function Empty({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: typeof Folder;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.04] text-zinc-500">
        <Icon size={26} />
      </span>
      <div>
        <p className="font-medium text-zinc-200">{title}</p>
        {hint && <p className="mt-1 text-sm text-zinc-500">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{msg}</div>;
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#111118] p-[18px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function ShareLinkModal({ link, onClose }: { link: string; onClose: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Modal onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-violet-300">
            <Share2 size={20} />
          </span>
          <div>
            <h3 className="font-semibold text-zinc-100">{t('drive.shareReady')}</h3>
            <p className="text-xs text-zinc-500">{t('drive.shareCopied')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input readOnly className="input font-mono text-xs" value={link} onFocus={(e) => e.target.select()} />
          <button
            className="btn-ghost shrink-0"
            onClick={async () => {
              await navigator.clipboard?.writeText(link).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
