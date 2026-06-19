'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicFile, PublicFolder } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function DrivePage() {
  const { refresh } = useAuth();
  const [folders, setFolders] = useState<PublicFolder[]>([]);
  const [files, setFiles] = useState<PublicFile[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadFolders = useCallback(async () => {
    const res = await api.get<{ folders: PublicFolder[] }>('/folders');
    // Hide vault folders here — they live under the Vault tab.
    setFolders(res.folders.filter((f) => !f.isZeroKnowledge));
  }, []);

  const loadFiles = useCallback(async (folderId: string | null) => {
    const q = folderId ? `?folderId=${folderId}` : '';
    const res = await api.get<{ files: PublicFile[] }>(`/files${q}`);
    setFiles(res.files);
  }, []);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadFiles(currentId).catch((e) => setError(String(e)));
  }, [currentId, loadFiles]);

  const childFolders = useMemo(
    () => folders.filter((f) => f.parentId === currentId),
    [folders, currentId],
  );

  const breadcrumb = useMemo(() => {
    const path: PublicFolder[] = [];
    let cursor = currentId;
    const byId = new Map(folders.map((f) => [f.id, f]));
    while (cursor) {
      const f = byId.get(cursor);
      if (!f) break;
      path.unshift(f);
      cursor = f.parentId;
    }
    return path;
  }, [currentId, folders]);

  async function onUpload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append('file', file);
        const q = currentId ? `?folderId=${currentId}` : '';
        await api.upload(`/files${q}`, form);
      }
      await Promise.all([loadFiles(currentId), refresh()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function createFolder() {
    const name = window.prompt('New folder name');
    if (!name) return;
    try {
      await api.post('/folders', { name, parentId: currentId });
      await loadFolders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create folder');
    }
  }

  async function deleteFile(id: string) {
    if (!window.confirm('Delete this file?')) return;
    await api.del(`/files/${id}`);
    await Promise.all([loadFiles(currentId), refresh()]);
  }

  /** List prior versions of a text file and optionally restore one. */
  async function versions(file: PublicFile) {
    try {
      const res = await api.get<{ versions: { id: string; sizeBytes: number; createdAt: string }[] }>(
        `/files/${file.id}/versions`,
      );
      if (res.versions.length === 0) {
        window.alert('This file has no previous versions yet. Re-upload a text file with the same name to create one.');
        return;
      }
      const lines = res.versions
        .map((v, i) => `${i}: ${new Date(v.createdAt).toLocaleString()} (${formatBytes(v.sizeBytes)})`)
        .join('\n');
      const choice = window.prompt(`Previous versions of ${file.name}:\n${lines}\n\nEnter a number to RESTORE it (current content is kept as a new version), or leave blank to cancel.`, '');
      if (!choice) return;
      const v = res.versions[Number(choice)];
      if (!v) return;
      await api.post(`/files/${file.id}/versions/${v.id}/restore`);
      await loadFiles(currentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load versions');
    }
  }

  async function renameFile(file: PublicFile) {
    const name = window.prompt('New file name', file.name);
    if (!name || name === file.name) return;
    try {
      await api.patch(`/files/${file.id}`, { name });
      await loadFiles(currentId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rename failed');
    }
  }

  /** Move a file or folder into another folder chosen from a numbered list. */
  async function move(kind: 'file' | 'folder', id: string) {
    const targets = [{ id: null as string | null, name: 'Home (root)' }, ...folders.filter((f) => f.id !== id)];
    const choice = window.prompt(
      `Move to which folder?\n${targets.map((t, i) => `${i}: ${t.name}`).join('\n')}`,
      '0',
    );
    if (choice === null) return;
    const target = targets[Number(choice)];
    if (!target) return;
    try {
      await api.patch(`/${kind}s/${id}`, { folderId: target.id, parentId: target.id });
      await Promise.all([loadFolders(), loadFiles(currentId)]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Move failed');
    }
  }

  /** Minimal prompt-driven share creation; copies the resulting link to the clipboard. */
  async function share(kind: 'file' | 'folder', id: string) {
    const mode = window.prompt('Access: 1 = anyone, 2 = anyone with a code, 3 = account holders', '1');
    if (mode === null) return;
    const accessMode = mode === '2' ? 'CODE' : mode === '3' ? 'AUTHENTICATED' : 'PUBLIC';
    const viewType = window.confirm('OK = preview page, Cancel = raw file link') ? 'PAGE' : 'RAW';
    let code: string | undefined;
    if (accessMode === 'CODE') {
      code = window.prompt('Set an access code (min 4 chars)') ?? undefined;
      if (!code || code.length < 4) return;
    }
    const days = window.prompt('Expire after how many days? (blank = never)', '');
    const expiresAt =
      days && Number(days) > 0 ? new Date(Date.now() + Number(days) * 86400_000).toISOString() : undefined;
    try {
      const body = kind === 'file' ? { fileId: id } : { folderId: id };
      const res = await api.post<{ share: { token: string } }>('/shares', {
        ...body,
        accessMode,
        viewType,
        code,
        expiresAt,
      });
      const url = `${window.location.origin}/s/${res.share.token}`;
      await navigator.clipboard?.writeText(url).catch(() => {});
      window.prompt('Share link (copied to clipboard):', url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create share');
    }
  }

  async function renameFolder(folder: PublicFolder) {
    const name = window.prompt('New folder name', folder.name);
    if (!name || name === folder.name) return;
    try {
      await api.patch(`/folders/${folder.id}`, { name });
      await loadFolders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rename failed');
    }
  }

  async function deleteFolder(id: string) {
    if (!window.confirm('Delete this folder and everything in it?')) return;
    await api.del(`/folders/${id}`);
    await Promise.all([loadFolders(), refresh()]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 text-sm text-neutral-500">
          <button className="hover:text-accent" onClick={() => setCurrentId(null)}>
            Home
          </button>
          {breadcrumb.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <span>/</span>
              <button className="hover:text-accent" onClick={() => setCurrentId(f.id)}>
                {f.name}
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={createFolder}>
            New folder
          </button>
          <button
            className="btn-primary"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div
        className="card divide-y divide-neutral-100 p-0 dark:divide-neutral-800"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onUpload(e.dataTransfer.files);
        }}
      >
        {childFolders.length === 0 && files.length === 0 && (
          <p className="p-8 text-center text-sm text-neutral-400">
            Empty folder. Drop files here or use Upload.
          </p>
        )}

        {childFolders.map((f) => (
          <div key={f.id} className="flex items-center justify-between px-4 py-3">
            <button className="flex items-center gap-2 text-sm" onClick={() => setCurrentId(f.id)}>
              <span>📁</span>
              <span className="font-medium">{f.name}</span>
            </button>
            <div className="flex gap-2">
              <button className="btn-ghost px-2 py-1" onClick={() => share('folder', f.id)}>
                Share
              </button>
              <button className="btn-ghost px-2 py-1" onClick={() => renameFolder(f)}>
                Rename
              </button>
              <button className="btn-ghost px-2 py-1" onClick={() => move('folder', f.id)}>
                Move
              </button>
              <button className="btn-danger px-2 py-1" onClick={() => deleteFolder(f.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}

        {files.map((file) => (
          <div key={file.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span>📄</span>
              <span className="font-medium">{file.name}</span>
              <span className="text-xs text-neutral-400">{formatBytes(file.sizeBytes)}</span>
              <AvBadge status={file.avStatus} />
            </div>
            <div className="flex gap-2">
              <a className="btn-ghost px-2 py-1" href={api.url(`/files/${file.id}/download`)}>
                Download
              </a>
              <button className="btn-ghost px-2 py-1" onClick={() => share('file', file.id)}>
                Share
              </button>
              <button className="btn-ghost px-2 py-1" onClick={() => versions(file)}>
                Versions
              </button>
              <button className="btn-ghost px-2 py-1" onClick={() => renameFile(file)}>
                Rename
              </button>
              <button className="btn-ghost px-2 py-1" onClick={() => move('file', file.id)}>
                Move
              </button>
              <button className="btn-danger px-2 py-1" onClick={() => deleteFile(file.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AvBadge({ status }: { status: PublicFile['avStatus'] }) {
  const map: Record<PublicFile['avStatus'], { label: string; cls: string }> = {
    CLEAN: { label: 'clean', cls: 'bg-green-100 text-green-700' },
    INFECTED: { label: 'infected', cls: 'bg-red-100 text-red-700' },
    PENDING: { label: 'pending', cls: 'bg-amber-100 text-amber-700' },
    SKIPPED: { label: 'unscanned', cls: 'bg-neutral-100 text-neutral-500' },
  };
  const { label, cls } = map[status];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${cls}`}>{label}</span>;
}
