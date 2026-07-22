'use client';

/**
 * A single Shared Space: a server-side-encrypted, collaborative file browser plus member
 * management. EDITORs can upload / create folders / rename / delete; VIEWERs are read-only.
 * The owner additionally manages members and the space lifecycle (rename, transfer, delete).
 *
 * Everything here is a normal SERVER-encrypted folder/file tagged with this space id — there is
 * no Zero-Knowledge mode and no new cryptography; the server gates each request on membership.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Users,
  Folder as FolderIcon,
  FolderPlus,
  Upload,
  Download,
  Trash2,
  Pencil,
  Home,
  ChevronRight,
  ArrowLeft,
  Crown,
  UserPlus,
  Settings2,
  LogOut,
  Eye,
  File as FileIcon,
  FolderLock,
} from 'lucide-react';
import type {
  PublicFile,
  PublicFolder,
  PublicSpaceDetail,
  PublicSpaceMember,
  SpaceRole,
} from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { Select } from '@/components/ui/Select';
import { FileViewer, type ViewerSource } from '@/components/FileViewer';
import { ContextMenu } from '@/components/drive/ContextMenu';
import { CrossCopyPicker, type CopyDest } from '@/components/drive/CrossCopyPicker';
import type { MenuItem } from '@/components/ui/Menu';
import { confirm, choose, prompt, toast } from '@/components/ui/overlays';

export default function SpacePage() {
  const { t } = useT();
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const spaceId = params.id;

  const [space, setSpace] = useState<PublicSpaceDetail | null>(null);
  const [folders, setFolders] = useState<PublicFolder[]>([]);
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [cwd, setCwd] = useState<string | null>(null); // current folder id (null = root)
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [showManage, setShowManage] = useState(false);
  const [viewing, setViewing] = useState<ViewerSource | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [copyItem, setCopyItem] = useState<{ kind: 'file' | 'folder'; id: string } | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const canWrite = space ? space.myRole === 'OWNER' || space.myRole === 'EDITOR' : false;
  const isOwner = space?.myRole === 'OWNER';

  const loadSpace = useCallback(async () => {
    const res = await api.get<{ space: PublicSpaceDetail }>(`/spaces/${spaceId}`);
    setSpace(res.space);
  }, [spaceId]);

  const loadFolders = useCallback(async () => {
    const res = await api.get<{ folders: PublicFolder[] }>(`/spaces/${spaceId}/folders`);
    setFolders(res.folders);
  }, [spaceId]);

  const loadFiles = useCallback(async () => {
    const q = cwd ? `?folderId=${encodeURIComponent(cwd)}` : '';
    const res = await api.get<{ files: PublicFile[] }>(`/spaces/${spaceId}/files${q}`);
    setFiles(res.files);
  }, [spaceId, cwd]);

  useEffect(() => {
    void Promise.all([loadSpace(), loadFolders()])
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [loadSpace, loadFolders]);

  useEffect(() => {
    void loadFiles().catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [loadFiles]);

  // Breadcrumb: walk parentId up from the current folder using the flat folder list.
  const trail = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const out: PublicFolder[] = [];
    let cur = cwd ? byId.get(cwd) : undefined;
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  }, [folders, cwd]);

  const childFolders = useMemo(() => folders.filter((f) => f.parentId === cwd), [folders, cwd]);

  async function refresh() {
    await Promise.all([loadSpace(), loadFolders(), loadFiles()]);
  }

  // ── Content actions ────────────────────────────────────────────────────────

  async function newFolder() {
    const name = await prompt({ title: t('space.newFolder'), label: t('space.nameLabel'), confirmLabel: t('space.create') });
    if (!name?.trim()) return;
    try {
      await api.post(`/spaces/${spaceId}/folders`, { name: name.trim(), parentId: cwd });
      await loadFolders();
      toast(t('space.folderCreated'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    const q = cwd ? `?folderId=${encodeURIComponent(cwd)}` : '';
    try {
      for (const f of Array.from(list)) {
        const form = new FormData();
        form.append('file', f);
        setUploadPct(0);
        await api.uploadWithProgress(`/spaces/${spaceId}/files${q}`, form, (p) => setUploadPct(Math.round(p * 100)));
      }
      await Promise.all([loadFiles(), loadSpace()]);
      toast(t('space.uploaded'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.uploadFailed'), 'error');
    } finally {
      setUploadPct(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function download(f: PublicFile) {
    window.open(`${API_URL}/spaces/${spaceId}/files/${f.id}/download`, '_blank');
  }

  // Open a file in the in-app viewer. Editors additionally get an editable text surface that
  // re-uploads under the same name (the upload pipeline versions it in place).
  function openFile(f: PublicFile) {
    setViewing({
      name: f.name,
      mime: f.mimeType,
      sizeBytes: f.sizeBytes,
      url: api.url(`/spaces/${spaceId}/files/${f.id}/download`),
      ...(canWrite
        ? {
            onSave: async (text: string) => {
              const form = new FormData();
              form.append('file', new File([text], f.name, { type: f.mimeType || 'text/plain' }));
              const q = f.folderId ? `?folderId=${encodeURIComponent(f.folderId)}` : '';
              await api.upload(`/spaces/${spaceId}/files${q}`, form);
              await Promise.all([loadFiles(), loadSpace()]);
            },
          }
        : {}),
    });
  }

  async function renameFile(f: PublicFile) {
    const name = await prompt({ title: t('space.rename'), defaultValue: f.name, confirmLabel: t('space.save') });
    if (!name?.trim() || name === f.name) return;
    try {
      await api.patch(`/spaces/${spaceId}/files/${f.id}`, { name: name.trim() });
      await loadFiles();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function renameFolder(f: PublicFolder) {
    const name = await prompt({ title: t('space.rename'), defaultValue: f.name, confirmLabel: t('space.save') });
    if (!name?.trim() || name === f.name) return;
    try {
      await api.patch(`/spaces/${spaceId}/folders/${f.id}`, { name: name.trim() });
      await loadFolders();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function deleteFile(f: PublicFile) {
    if (!(await confirm({ title: t('space.deleteFileTitle'), message: t('space.deleteFileMsg', { name: f.name }), danger: true, confirmLabel: t('space.delete') }))) return;
    try {
      await api.del(`/spaces/${spaceId}/files/${f.id}`);
      await Promise.all([loadFiles(), loadSpace()]);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function deleteFolder(f: PublicFolder) {
    if (!(await confirm({ title: t('space.deleteFolderTitle'), message: t('space.deleteFolderMsg', { name: f.name }), danger: true, confirmLabel: t('space.delete') }))) return;
    try {
      await api.del(`/spaces/${spaceId}/folders/${f.id}`);
      await Promise.all([loadFolders(), loadFiles(), loadSpace()]);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  // ── Cross-realm copy: shared space → personal Drive ────────────────────────
  // Any member (even a VIEWER) can pull a copy into their own Drive — it's billed to THEIR quota via
  // the normal personal upload endpoint, and reads are already allowed by membership.
  async function copyFileToPersonal(destFolderId: string, srcId: string, name: string) {
    const res = await fetch(api.url(`/spaces/${spaceId}/files/${srcId}/download`), { credentials: 'include' });
    if (!res.ok) throw new ApiError(res.status, t('space.copyFailed'));
    const blob = await res.blob();
    const form = new FormData();
    form.append('file', new File([blob], name));
    await api.upload(`/files?folderId=${encodeURIComponent(destFolderId)}`, form);
  }
  async function copyFolderToPersonal(destParentId: string, folderId: string, name: string) {
    const created = await api.post<{ folder: { id: string } }>('/folders', { name, parentId: destParentId });
    const newId = created.folder.id;
    const { files: kids } = await api.get<{ files: PublicFile[] }>(`/spaces/${spaceId}/files?folderId=${encodeURIComponent(folderId)}`);
    for (const f of kids) await copyFileToPersonal(newId, f.id, f.name);
    for (const sub of folders.filter((x) => x.parentId === folderId)) {
      await copyFolderToPersonal(newId, sub.id, sub.name);
    }
  }
  async function performCopyToPersonal(dest: CopyDest) {
    if (dest.realm !== 'personal' || !copyItem) return;
    const item = copyItem;
    setCopyItem(null);
    setCopyBusy(true);
    try {
      if (item.kind === 'file') {
        const f = files.find((x) => x.id === item.id);
        if (f) await copyFileToPersonal(dest.folderId, f.id, f.name);
      } else {
        const fld = folders.find((x) => x.id === item.id);
        if (fld) await copyFolderToPersonal(dest.folderId, fld.id, fld.name);
      }
      toast(t('space.copiedToPersonal', { name: dest.label }), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.copyFailed'), 'error');
    } finally {
      setCopyBusy(false);
    }
  }

  // ── Right-click menus ──────────────────────────────────────────────────────
  function fileMenu(f: PublicFile): MenuItem[] {
    const items: MenuItem[] = [
      { label: t('space.openFile'), icon: Eye, onClick: () => openFile(f) },
      { label: t('space.download'), icon: Download, onClick: () => download(f) },
      { label: t('space.copyToPersonal'), icon: FolderLock, onClick: () => setCopyItem({ kind: 'file', id: f.id }) },
    ];
    if (canWrite) {
      items.push({ label: t('space.rename'), icon: Pencil, onClick: () => void renameFile(f) });
      items.push({ label: t('space.delete'), icon: Trash2, danger: true, onClick: () => void deleteFile(f) });
    }
    return items;
  }
  function folderMenu(f: PublicFolder): MenuItem[] {
    const items: MenuItem[] = [
      { label: t('space.openFile'), icon: FolderIcon, onClick: () => setCwd(f.id) },
      { label: t('space.copyToPersonal'), icon: FolderLock, onClick: () => setCopyItem({ kind: 'folder', id: f.id }) },
    ];
    if (canWrite) {
      items.push({ label: t('space.rename'), icon: Pencil, onClick: () => void renameFolder(f) });
      items.push({ label: t('space.delete'), icon: Trash2, danger: true, onClick: () => void deleteFolder(f) });
    }
    return items;
  }
  function bgMenu(): MenuItem[] {
    if (!canWrite) return [];
    return [
      { label: t('space.newFolder'), icon: FolderPlus, onClick: () => void newFolder() },
      { label: t('space.upload'), icon: Upload, onClick: () => fileInput.current?.click() },
    ];
  }
  function openCtx(ev: React.MouseEvent, items: MenuItem[]) {
    if (items.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    setCtxMenu({ x: ev.clientX, y: ev.clientY, items });
  }

  // ── Member & lifecycle actions ─────────────────────────────────────────────

  async function addMember() {
    const email = await prompt({ title: t('space.addMember'), label: t('space.memberEmail'), placeholder: 'user@example.com', confirmLabel: t('space.add') });
    if (!email?.trim()) return;
    const role = await choose<SpaceRole>({
      title: t('space.chooseRole'),
      options: [
        { value: 'EDITOR', label: t('space.roleEditor'), description: t('space.roleEditorHint') },
        { value: 'VIEWER', label: t('space.roleViewer'), description: t('space.roleViewerHint') },
      ],
    });
    if (!role) return;
    try {
      await api.post(`/spaces/${spaceId}/members`, { email: email.trim(), role });
      await loadSpace();
      toast(t('space.memberAdded'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function changeRole(m: PublicSpaceMember, role: SpaceRole) {
    if (role === m.role) return;
    try {
      await api.patch(`/spaces/${spaceId}/members/${m.userId}`, { role });
      await loadSpace();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function removeMember(m: PublicSpaceMember) {
    if (!(await confirm({ title: t('space.removeMemberTitle'), message: t('space.removeMemberMsg', { email: m.email }), danger: true, confirmLabel: t('space.remove') }))) return;
    try {
      await api.del(`/spaces/${spaceId}/members/${m.userId}`);
      await loadSpace();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function renameSpace() {
    if (!space) return;
    const name = await prompt({ title: t('space.renameSpace'), defaultValue: space.name, confirmLabel: t('space.save') });
    if (!name?.trim() || name === space.name) return;
    try {
      await api.patch(`/spaces/${spaceId}`, { name: name.trim() });
      await loadSpace();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function leaveSpace() {
    if (!user) return;
    if (!(await confirm({ title: t('space.leaveTitle'), message: t('space.leaveMsg'), danger: true, confirmLabel: t('space.leave') }))) return;
    try {
      await api.del(`/spaces/${spaceId}/members/${user.id}`);
      router.push('/spaces');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  async function deleteSpace() {
    if (!space) return;
    // If there are members, offer the transfer-vs-delete choice; otherwise a plain delete.
    let mode: 'delete' | 'transfer' = 'delete';
    if (space.memberCount > 0) {
      const picked = await choose<'delete' | 'transfer'>({
        title: t('space.deleteSpaceTitle'),
        message: t('space.deleteSpaceMsg'),
        options: [
          { value: 'transfer', label: t('space.modeTransfer'), description: t('space.modeTransferHint') },
          { value: 'delete', label: t('space.modeDelete'), description: t('space.modeDeleteHint') },
        ],
      });
      if (!picked) return;
      mode = picked;
    } else {
      if (!(await confirm({ title: t('space.deleteSpaceTitle'), message: t('space.modeDeleteHint'), danger: true, confirmLabel: t('space.delete') }))) return;
    }
    try {
      const res = await api.del<{ transferredTo?: string; deleted?: boolean }>(`/spaces/${spaceId}?mode=${mode}`);
      toast(res.transferredTo ? t('space.transferred') : t('space.spaceDeleted'), 'success');
      router.push('/spaces');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('space.actionFailed'), 'error');
    }
  }

  if (loading) return <p className="text-sm text-zinc-500">{t('common.loading')}</p>;
  if (!space) {
    return (
      <div className="space-y-4">
        {error && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</div>}
        <Link href="/spaces" className="btn-ghost inline-flex"><ArrowLeft size={15} /> {t('space.backToList')}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/spaces" className="mb-1 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
            <ArrowLeft size={13} /> {t('space.backToList')}
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <Users size={22} className="text-violet-300" /> {space.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {t(space.myRole === 'OWNER' ? 'space.roleOwner' : space.myRole === 'EDITOR' ? 'space.roleEditor' : 'space.roleViewer')}
            {!isOwner && ` · ${t('space.ownedBy', { email: space.ownerEmail })}`}
            {' · '}{formatBytes(space.usedBytes)} {t('space.stored')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="btn-ghost" onClick={() => setShowManage((s) => !s)}>
            <Settings2 size={15} /> {t('space.manage')}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300">{error}</div>}

      {/* Manage panel: members + lifecycle */}
      {showManage && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-zinc-100"><Users size={16} /> {t('space.members')}</h2>
            {isOwner && (
              <button className="btn-ghost px-2.5 py-1 text-xs" onClick={addMember}>
                <UserPlus size={14} /> {t('space.addMember')}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {/* Owner row */}
            <div className="row">
              <div className="flex min-w-0 items-center gap-2">
                <Crown size={15} className="shrink-0 text-amber-300" />
                <span className="truncate text-sm text-zinc-200">{space.ownerEmail}</span>
              </div>
              <span className="text-xs text-zinc-500">{t('space.roleOwner')}</span>
            </div>
            {space.members.length === 0 && <p className="px-1 py-2 text-xs text-zinc-500">{t('space.noMembers')}</p>}
            {space.members.map((m) => (
              <div key={m.userId} className="row">
                <span className="min-w-0 truncate text-sm text-zinc-200">{m.email}</span>
                <div className="flex shrink-0 items-center gap-2">
                  {isOwner ? (
                    <>
                      <Select
                        className="w-28"
                        value={m.role}
                        onChange={(v) => changeRole(m, v as SpaceRole)}
                        options={[
                          { value: 'EDITOR', label: t('space.roleEditor') },
                          { value: 'VIEWER', label: t('space.roleViewer') },
                        ]}
                      />
                      <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-red-300" title={t('space.remove')} onClick={() => removeMember(m)}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-zinc-500">{t(m.role === 'EDITOR' ? 'space.roleEditor' : 'space.roleViewer')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Lifecycle */}
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
            {isOwner ? (
              <>
                <button className="btn-ghost" onClick={renameSpace}><Pencil size={15} /> {t('space.renameSpace')}</button>
                <button className="btn-ghost text-red-300 hover:text-red-200" onClick={deleteSpace}><Trash2 size={15} /> {t('space.deleteSpace')}</button>
              </>
            ) : (
              <button className="btn-ghost text-red-300 hover:text-red-200" onClick={leaveSpace}><LogOut size={15} /> {t('space.leave')}</button>
            )}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-zinc-400">
          <button className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd(null)}>
            <Home size={14} /> {space.name}
          </button>
          {trail.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight size={13} className="text-zinc-600" />
              <button className="rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-zinc-100" onClick={() => setCwd(f.id)}>{f.name}</button>
            </span>
          ))}
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-2">
            <button className="btn-ghost" onClick={newFolder}><FolderPlus size={15} /> {t('space.newFolder')}</button>
            <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={uploadPct !== null}>
              <Upload size={15} /> {uploadPct !== null ? t('space.uploadingPct', { pct: uploadPct }) : t('space.upload')}
            </button>
            <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          </div>
        )}
      </div>

      {/* Listing */}
      {childFolders.length === 0 && files.length === 0 ? (
        <div
          className="card flex flex-col items-center gap-2 py-14 text-center"
          onContextMenu={(ev) => openCtx(ev, bgMenu())}
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[0.04] text-zinc-500"><FolderIcon size={22} /></span>
          <p className="text-sm text-zinc-400">{t('space.emptyFolder')}</p>
        </div>
      ) : (
        <div className="space-y-1.5" onContextMenu={(ev) => openCtx(ev, bgMenu())}>
          {childFolders.map((f) => (
            <div key={f.id} className="row" onContextMenu={(ev) => openCtx(ev, folderMenu(f))}>
              <button className="flex min-w-0 items-center gap-3" onClick={() => setCwd(f.id)}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-amber-200"><FolderIcon size={16} /></span>
                <span className="truncate font-medium text-zinc-100">{f.name}</span>
              </button>
              {canWrite && (
                <div className="flex shrink-0 items-center gap-1">
                  <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100" title={t('space.rename')} onClick={() => renameFolder(f)}><Pencil size={15} /></button>
                  <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-red-300" title={t('space.delete')} onClick={() => deleteFolder(f)}><Trash2 size={15} /></button>
                </div>
              )}
            </div>
          ))}
          {files.map((f) => (
            <div key={f.id} className="row" onContextMenu={(ev) => openCtx(ev, fileMenu(f))}>
              <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => openFile(f)} title={t('space.openFile')}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-violet-300"><FileIcon size={16} /></span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">{f.name}</p>
                  <p className="text-xs text-zinc-500">{formatBytes(f.sizeBytes)}</p>
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100" title={t('space.download')} onClick={() => download(f)}><Download size={15} /></button>
                {canWrite && (
                  <>
                    <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-zinc-100" title={t('space.rename')} onClick={() => renameFile(f)}><Pencil size={15} /></button>
                    <button className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-red-300" title={t('space.delete')} onClick={() => deleteFile(f)}><Trash2 size={15} /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && <FileViewer source={viewing} onClose={() => setViewing(null)} />}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}
      {copyItem && (
        <CrossCopyPicker target="personal" count={1} onPick={(d) => void performCopyToPersonal(d)} onClose={() => setCopyItem(null)} />
      )}
      {copyBusy && (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-black/50 backdrop-blur-sm">
          <div className="rounded-xl border border-white/10 bg-[#15151d] px-5 py-4 text-sm text-zinc-200 shadow-2xl">
            {t('space.copying')}
          </div>
        </div>
      )}
    </div>
  );
}
