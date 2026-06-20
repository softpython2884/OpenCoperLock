'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicFolder } from '@opencoperlock/shared/client';
import { formatBytes } from '@opencoperlock/shared/client';
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

export default function VaultPage() {
  const { refresh } = useAuth();
  const [vaults, setVaults] = useState<PublicFolder[]>([]);
  const [activeVault, setActiveVault] = useState<string | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [files, setFiles] = useState<ZkFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadVaults = useCallback(async () => {
    const res = await api.get<{ folders: PublicFolder[] }>('/folders');
    setVaults(res.folders.filter((f) => f.isZeroKnowledge));
  }, []);

  useEffect(() => {
    void loadVaults();
  }, [loadVaults]);

  const openVault = useCallback(
    async (folderId: string, key: CryptoKey) => {
      const res = await api.get<{ files: ZkFile[] }>(`/zk/files?folderId=${folderId}`);
      const withNames = await Promise.all(
        res.files.map(async (f) => ({
          ...f,
          plainName: await decryptName(key, f.encryptedName, f.wrappedKey),
        })),
      );
      setFiles(withNames);
    },
    [],
  );

  async function unlock(folderId: string) {
    const passphrase = window.prompt('Enter the passphrase for this vault');
    if (!passphrase) return;
    setError(null);
    try {
      const vault = vaults.find((v) => v.id === folderId);
      const key = await deriveVaultKey(passphrase, vault?.zkSalt ?? null);
      setVaultKey(key);
      setActiveVault(folderId);
      await openVault(folderId, key);
    } catch (err) {
      setError(String(err));
    }
  }

  async function createVault() {
    const name = window.prompt('New vault name');
    if (!name) return;
    try {
      await api.post('/folders', { name, isZeroKnowledge: true });
      await loadVaults();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create vault');
    }
  }

  async function onUpload(list: FileList | null) {
    if (!list || !activeVault || !vaultKey) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        const enc = await encryptFile(vaultKey, file);
        const form = new FormData();
        form.append(
          'meta',
          JSON.stringify({
            folderId: activeVault,
            encryptedName: enc.encryptedName,
            iv: enc.iv,
            wrappedKey: enc.wrappedKey,
            encMode: 'ZK',
          }),
        );
        form.append('file', enc.blob, 'blob');
        await api.upload('/zk/files', form);
      }
      await Promise.all([openVault(activeVault, vaultKey), refresh()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Encryption/upload failed');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function download(file: ZkFile) {
    if (!vaultKey) return;
    const res = await fetch(`${API_URL}/zk/files/${file.id}/blob`, { credentials: 'include' });
    const ciphertext = await res.arrayBuffer();
    const blob = await decryptBlob(vaultKey, ciphertext, file.iv, file.wrappedKey);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.plainName?.replace(/^🔒.*/, 'decrypted') ?? 'decrypted';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(file: ZkFile) {
    if (!activeVault || !vaultKey) return;
    if (!window.confirm('Delete this vault file?')) return;
    await api.del(`/zk/files/${file.id}`);
    await Promise.all([openVault(activeVault, vaultKey), refresh()]);
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-1 border-accent/30 bg-accent/5">
        <h1 className="text-lg font-semibold">🔒 Zero-Knowledge Vault</h1>
        <p className="text-sm text-neutral-500">
          Files here are encrypted <strong>in your browser</strong> before upload. The server only
          ever stores ciphertext and can never read them — so they are <em>not</em> antivirus-scanned
          and cannot be retrieved if you forget the passphrase.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {vaults.map((v) => (
            <button
              key={v.id}
              className={`btn-ghost ${activeVault === v.id ? 'border-accent text-accent' : ''}`}
              onClick={() => unlock(v.id)}
            >
              🔒 {v.name}
            </button>
          ))}
          {vaults.length === 0 && <span className="text-sm text-neutral-400">No vaults yet.</span>}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={createVault}>
            New vault
          </button>
          <button
            className="btn-primary"
            disabled={!activeVault || !vaultKey || busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? 'Encrypting…' : 'Upload to vault'}
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

      {activeVault && vaultKey ? (
        <div className="card divide-y divide-neutral-100 p-0 dark:divide-neutral-800">
          {files.length === 0 && (
            <p className="p-8 text-center text-sm text-neutral-400">This vault is empty.</p>
          )}
          {files.map((file) => (
            <div key={file.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <span>🔐</span>
                <span className="font-medium">{file.plainName}</span>
                <span className="text-xs text-neutral-400">{formatBytes(file.sizeBytes)}</span>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost px-2 py-1" onClick={() => download(file)}>
                  Download
                </button>
                <button className="btn-danger px-2 py-1" onClick={() => remove(file)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-400">Select a vault and enter its passphrase to unlock.</p>
      )}
    </div>
  );
}
