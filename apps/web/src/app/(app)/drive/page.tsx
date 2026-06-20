'use client';

/**
 * "Mes Espaces" — the main workspace. A Space is a top-level folder that is either:
 *   - normal   : files are encrypted server-side (AES-256-GCM at rest), or
 *   - secured  : a Zero-Knowledge vault, encrypted in the browser with a passphrase the
 *                server never sees. The passphrase is cached in sessionStorage for the tab
 *                so it is asked once per session, then used to derive the vault key.
 *
 * Inside a space you can create folders, upload (drag & drop + progress), download, delete,
 * and (for normal spaces) rename / move / share / browse versions. Grid or list view.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Folder,
  FolderLock,
  FolderPlus,
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
  Home,
  Lock,
  ShieldCheck,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  KeyRound,
} from 'lucide-react';
import type { PublicFile, PublicFolder } from '@opencoperlock/shared/client';
import { formatBytes, mimeKind } from '@opencoperlock/shared/client';
import { api, API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { decryptBlob, decryptName, deriveVaultKey, encryptFile } from '@/lib/zk';

interface ZkFile {
  id: string;
  encryptedName: string;
  iv: string;
  wrappedKey: string;
  sizeBytes: number;
  plainName?: string;
}

function passKey(spaceId: string) {
  return `ocl_pass_${spaceId}`;
}

function fileIcon(name: string, mime?: string) {
  const kind = mime ? mimeKind(mime) : 'other';
  if (kind === 'image') return ImageIcon;
  if (kind === 'video') return Film;
  if (kind === 'audio') return Music;
  return FileText;
}

export default function EspacesPage() {
  const { refresh } = useAuth();
  const [allFolders, setAllFolders] = useState<PublicFolder[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [zkFiles, setZkFiles] = useState<ZkFile[]>([]);
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // passphrase prompt
  const [askPass, setAskPass] = useState<PublicFolder | null>(null);
  const [passInput, setPassInput] = useState('');

  const spaces = useMemo(() => allFolders.filter((f) => f.parentId === null), [allFolders]);
  const activeSpace = useMemo(
    () => allFolders.find((f) => f.id === activeSpaceId) ?? null,
    [allFolders, activeSpaceId],
  );
  const isZk = activeSpace?.isZeroKnowledge ?? false;
  const childFolders = useMemo(
    () => allFolders.filter((f) => f.parentId === currentFolderId),
    [allFolders, currentFolderId],
  );

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
    return res.folders;
  }, []);

  const loadItems = useCallback(
    async (folderId: string, zk: boolean, key: CryptoKey | null) => {
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
    },
    [],
  );

  useEffect(() => {
    void loadFolders().catch((e) => setError(String(e)));
  }, [loadFolders]);

  // Reload items whenever we change folder/key.
  useEffect(() => {
    if (!activeSpaceId || !currentFolderId) return;
    if (isZk && !vaultKey) return; // wait for passphrase
    void loadItems(currentFolderId, isZk, vaultKey).catch((e) => setError(String(e)));
  }, [activeSpaceId, currentFolderId, isZk, vaultKey, loadItems]);

  async function enterSpace(space: PublicFolder) {
    setError(null);
    setActiveSpaceId(space.id);
    setCurrentFolderId(space.id);
    setVaultKey(null);
    if (space.isZeroKnowledge) {
      const cached = sessionStorage.getItem(passKey(space.id));
      if (cached) {
        setVaultKey(await deriveVaultKey(cached, space.zkSalt));
      } else {
        setPassInput('');
        setAskPass(space);
      }
    }
  }

  async function submitPassphrase() {
    if (!askPass || !passInput) return;
    const key = await deriveVaultKey(passInput, askPass.zkSalt);
    sessionStorage.setItem(passKey(askPass.id), passInput);
    setVaultKey(key);
    setAskPass(null);
    setPassInput('');
  }

  function leaveSpace() {
    setActiveSpaceId(null);
    setCurrentFolderId(null);
    setVaultKey(null);
    setFiles([]);
    setZkFiles([]);
  }

  async function createSpace() {
    const name = window.prompt('Nom du nouvel espace');
    if (!name) return;
    const secured = window.confirm(
      'Créer un espace SÉCURISÉ (Zero-Knowledge, chiffré dans le navigateur) ?\n\nOK = sécurisé · Annuler = espace normal (chiffré côté serveur).',
    );
    try {
      await api.post('/folders', { name, isZeroKnowledge: secured });
      await loadFolders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible');
    }
  }

  async function createFolder() {
    const name = window.prompt('Nom du dossier');
    if (!name) return;
    try {
      await api.post('/folders', { name, parentId: currentFolderId, isZeroKnowledge: isZk });
      await loadFolders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible');
    }
  }

  async function onUpload(list: FileList | null) {
    if (!list || list.length === 0 || !currentFolderId) return;
    const arr = Array.from(list);
    setError(null);
    try {
      if (isZk) {
        if (!vaultKey) return;
        for (let i = 0; i < arr.length; i += 1) {
          setBusy(`Chiffrement ${i + 1}/${arr.length}…`);
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
        for (let i = 0; i < arr.length; i += 1) {
          setBusy(`Envoi ${i + 1}/${arr.length}…`);
          setProgress(0);
          const form = new FormData();
          form.append('file', arr[i]!);
          await api.uploadWithProgress(`/files?folderId=${currentFolderId}`, form, setProgress);
        }
      }
      await Promise.all([loadItems(currentFolderId, isZk, vaultKey), refresh()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'envoi");
    } finally {
      setBusy(null);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function downloadZk(f: ZkFile) {
    if (!vaultKey) return;
    const res = await fetch(`${API_URL}/zk/files/${f.id}/blob`, { credentials: 'include' });
    const blob = await decryptBlob(vaultKey, await res.arrayBuffer(), f.iv, f.wrappedKey);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.plainName && !f.plainName.startsWith('🔒') ? f.plainName : 'fichier';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function reloadCurrent() {
    if (currentFolderId) await Promise.all([loadItems(currentFolderId, isZk, vaultKey), refresh()]);
  }

  async function deleteFile(id: string) {
    if (!window.confirm('Supprimer ce fichier ?')) return;
    await api.del(isZk ? `/zk/files/${id}` : `/files/${id}`);
    await reloadCurrent();
  }
  async function deleteFolder(id: string) {
    if (!window.confirm('Supprimer ce dossier et tout son contenu ?')) return;
    await api.del(`/folders/${id}`);
    await Promise.all([loadFolders(), refresh()]);
  }
  async function renameFile(f: PublicFile) {
    const name = window.prompt('Nouveau nom', f.name);
    if (!name || name === f.name) return;
    await api.patch(`/files/${f.id}`, { name });
    await reloadCurrent();
  }
  async function renameFolder(f: PublicFolder) {
    const name = window.prompt('Nouveau nom', f.name);
    if (!name || name === f.name) return;
    await api.patch(`/folders/${f.id}`, { name });
    await loadFolders();
  }
  async function move(kind: 'file' | 'folder', id: string) {
    const targets = [
      { id: null as string | null, name: 'Racine de l’espace' },
      ...allFolders.filter((f) => f.id !== id && f.isZeroKnowledge === isZk),
    ];
    const choice = window.prompt(
      `Déplacer vers :\n${targets.map((t, i) => `${i}: ${t.name}`).join('\n')}`,
      '0',
    );
    if (choice === null) return;
    const t = targets[Number(choice)];
    if (!t) return;
    await api.patch(`/${kind}s/${id}`, { folderId: t.id, parentId: t.id });
    await Promise.all([loadFolders(), reloadCurrent()]);
  }
  async function share(kind: 'file' | 'folder', id: string) {
    const mode = window.prompt('Accès : 1 = tout le monde, 2 = avec un code, 3 = comptes only', '1');
    if (mode === null) return;
    const accessMode = mode === '2' ? 'CODE' : mode === '3' ? 'AUTHENTICATED' : 'PUBLIC';
    const viewType = window.confirm('OK = page d’aperçu · Annuler = fichier brut') ? 'PAGE' : 'RAW';
    let code: string | undefined;
    if (accessMode === 'CODE') {
      code = window.prompt('Code d’accès (min 4)') ?? undefined;
      if (!code || code.length < 4) return;
    }
    try {
      const body = kind === 'file' ? { fileId: id } : { folderId: id };
      const res = await api.post<{ share: { token: string } }>('/shares', { ...body, accessMode, viewType, code });
      const link = `${window.location.origin}/s/${res.share.token}`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      window.prompt('Lien de partage (copié) :', link);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Partage impossible');
    }
  }
  async function versions(f: PublicFile) {
    try {
      const res = await api.get<{ versions: { id: string; sizeBytes: number; createdAt: string }[] }>(
        `/files/${f.id}/versions`,
      );
      if (res.versions.length === 0) {
        window.alert('Aucune version antérieure. Ré-uploade un fichier texte du même nom pour en créer.');
        return;
      }
      const lines = res.versions
        .map((v, i) => `${i}: ${new Date(v.createdAt).toLocaleString()} (${formatBytes(v.sizeBytes)})`)
        .join('\n');
      const c = window.prompt(`Versions de ${f.name} :\n${lines}\n\nNuméro à restaurer (vide = annuler)`, '');
      if (!c) return;
      const v = res.versions[Number(c)];
      if (!v) return;
      await api.post(`/files/${f.id}/versions/${v.id}/restore`);
      await reloadCurrent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Versions indisponibles');
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!activeSpaceId) {
    return (
      <div className="space-y-6">
        <Header title="Mes Espaces" subtitle="Vos dossiers chiffrés, normaux ou sécurisés.">
          <button className="btn-primary" onClick={createSpace}>
            <Plus size={16} /> Nouvel espace
          </button>
        </Header>
        {error && <ErrorLine msg={error} />}
        {spaces.length === 0 ? (
          <Empty
            icon={FolderLock}
            title="Aucun espace pour l’instant"
            hint="Créez votre premier espace pour commencer à stocker des fichiers."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {spaces.map((s) => (
              <button
                key={s.id}
                onClick={() => enterSpace(s)}
                className="card group flex items-center gap-4 text-left transition hover:border-accent/40 hover:bg-white/[0.04]"
              >
                <span
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${
                    s.isZeroKnowledge
                      ? 'bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 text-violet-200'
                      : 'bg-white/[0.05] text-zinc-300'
                  }`}
                >
                  {s.isZeroKnowledge ? <ShieldCheck size={22} /> : <Folder size={22} />}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">{s.name}</p>
                  <p className="text-xs text-zinc-500">
                    {s.isZeroKnowledge ? 'Sécurisé · Zero-Knowledge' : 'Espace normal · chiffré serveur'}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Inside a space
  const needPass = isZk && !vaultKey;

  return (
    <div className="space-y-5">
      {/* breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-zinc-500">
        <button className="flex items-center gap-1 hover:text-zinc-200" onClick={leaveSpace}>
          <Home size={15} /> Espaces
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

      <Header
        title={activeSpace?.name ?? ''}
        subtitle={isZk ? 'Dossier sécurisé · Zero-Knowledge' : 'Dossier chiffré côté serveur'}
        badge={isZk ? 'secured' : undefined}
      >
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
            <ViewBtn active={view === 'list'} onClick={() => setView('list')} icon={ListIcon} />
            <ViewBtn active={view === 'grid'} onClick={() => setView('grid')} icon={LayoutGrid} />
          </div>
          <button className="btn-ghost" onClick={createFolder} disabled={needPass}>
            <FolderPlus size={16} /> Dossier
          </button>
          <button
            className="btn-primary"
            onClick={() => fileInput.current?.click()}
            disabled={needPass || !!busy}
          >
            <Upload size={16} /> {busy ?? 'Importer'}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
        </div>
      </Header>

      {error && <ErrorLine msg={error} />}

      {progress !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {needPass ? (
        <Empty
          icon={KeyRound}
          title="Espace verrouillé"
          hint="Entrez la phrase de passe de cet espace pour le déverrouiller."
        >
          <button className="btn-primary" onClick={() => setAskPass(activeSpace)}>
            <Lock size={16} /> Déverrouiller
          </button>
        </Empty>
      ) : (
        <div
          className={`rounded-2xl border-2 border-dashed p-1 transition ${
            dragging ? 'border-accent/60 bg-accent/[0.04]' : 'border-transparent'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void onUpload(e.dataTransfer.files);
          }}
        >
          {childFolders.length === 0 && files.length === 0 && zkFiles.length === 0 ? (
            <Empty icon={Upload} title="Dossier vide" hint="Glissez-déposez des fichiers ici, ou utilisez Importer." />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 p-2 sm:grid-cols-3 lg:grid-cols-4">
              {childFolders.map((f) => (
                <GridCard key={f.id} icon={isZk ? FolderLock : Folder} name={f.name} onOpen={() => setCurrentFolderId(f.id)} />
              ))}
              {files.map((f) => (
                <GridCard key={f.id} icon={fileIcon(f.name, f.mimeType)} name={f.name} sub={formatBytes(f.sizeBytes)} />
              ))}
              {zkFiles.map((f) => (
                <GridCard key={f.id} icon={Lock} name={f.plainName ?? '🔒'} sub={formatBytes(f.sizeBytes)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2 p-1">
              {childFolders.map((f) => (
                <div key={f.id} className="row">
                  <button className="flex min-w-0 items-center gap-3" onClick={() => setCurrentFolderId(f.id)}>
                    {isZk ? <FolderLock size={18} className="text-violet-300" /> : <Folder size={18} className="text-zinc-400" />}
                    <span className="truncate font-medium text-zinc-100">{f.name}</span>
                  </button>
                  <RowActions>
                    <IconBtn title="Renommer" icon={Pencil} onClick={() => renameFolder(f)} />
                    {!isZk && <IconBtn title="Partager" icon={Share2} onClick={() => share('folder', f.id)} />}
                    <IconBtn title="Supprimer" danger icon={Trash2} onClick={() => deleteFolder(f.id)} />
                  </RowActions>
                </div>
              ))}

              {files.map((f) => {
                const Icon = fileIcon(f.name, f.mimeType);
                return (
                  <div key={f.id} className="row">
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon size={18} className="text-zinc-400" />
                      <span className="truncate font-medium text-zinc-100">{f.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{formatBytes(f.sizeBytes)}</span>
                    </div>
                    <RowActions>
                      <a className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-zinc-100" title="Télécharger" href={api.url(`/files/${f.id}/download`)}>
                        <Download size={16} />
                      </a>
                      <IconBtn title="Renommer" icon={Pencil} onClick={() => renameFile(f)} />
                      <IconBtn title="Déplacer" icon={FolderInput} onClick={() => move('file', f.id)} />
                      <IconBtn title="Partager" icon={Share2} onClick={() => share('file', f.id)} />
                      <IconBtn title="Versions" icon={History} onClick={() => versions(f)} />
                      <IconBtn title="Supprimer" danger icon={Trash2} onClick={() => deleteFile(f.id)} />
                    </RowActions>
                  </div>
                );
              })}

              {zkFiles.map((f) => (
                <div key={f.id} className="row">
                  <div className="flex min-w-0 items-center gap-3">
                    <Lock size={18} className="text-violet-300" />
                    <span className="truncate font-medium text-zinc-100">{f.plainName ?? '🔒'}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{formatBytes(f.sizeBytes)}</span>
                  </div>
                  <RowActions>
                    <IconBtn title="Télécharger" icon={Download} onClick={() => downloadZk(f)} />
                    <IconBtn title="Supprimer" danger icon={Trash2} onClick={() => deleteFile(f.id)} />
                  </RowActions>
                </div>
              ))}
            </div>
          )}
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
                <h3 className="font-semibold text-zinc-100">Espace sécurisé</h3>
                <p className="text-xs text-zinc-500">{askPass.name}</p>
              </div>
            </div>
            <p className="text-sm text-zinc-400">
              Cette phrase de passe chiffre vos fichiers dans le navigateur. Le serveur ne la voit
              jamais — elle est irrécupérable si vous l’oubliez.
            </p>
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
                placeholder="Phrase de passe"
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setAskPass(null)}>
                  Annuler
                </button>
                <button type="submit" className="btn-primary" disabled={!passInput}>
                  Déverrouiller
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────

function Header({
  title,
  subtitle,
  badge,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: 'secured';
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          {badge === 'secured' && (
            <span className="chip bg-accent-soft text-violet-300">
              <ShieldCheck size={12} /> Sécurisé
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

function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>;
}

function IconBtn({
  icon: Icon,
  title,
  onClick,
  danger,
}: {
  icon: typeof Pencil;
  title: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition hover:bg-white/5 ${
        danger ? 'text-zinc-400 hover:text-red-300' : 'text-zinc-400 hover:text-zinc-100'
      }`}
    >
      <Icon size={16} />
    </button>
  );
}

function GridCard({
  icon: Icon,
  name,
  sub,
  onOpen,
}: {
  icon: typeof Folder;
  name: string;
  sub?: string;
  onOpen?: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="card flex flex-col items-center gap-2 py-5 text-center transition hover:border-white/15 hover:bg-white/[0.04]"
    >
      <Icon size={30} className="text-zinc-400" />
      <span className="line-clamp-2 w-full break-words text-sm font-medium text-zinc-100">{name}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </button>
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
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{msg}</div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-md border-white/10 bg-ink-850" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
