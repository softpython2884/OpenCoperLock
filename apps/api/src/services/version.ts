/**
 * Version tracking & one-click self-update.
 *
 * The deployment is a plain git checkout, so the "version" is simply the checked-out commit
 * SHA. We read it at runtime, compare it against the tracked branch on GitHub, and — for
 * admins — kick off an in-place update (git reset + rebuild + PM2 reload) by spawning a
 * detached script that survives the API restart.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Env } from '../env.js';

const exec = promisify(execFile);

export interface LocalVersion {
  sha: string | null;
  shortSha: string | null;
  subject: string | null;
  committedAt: string | null;
  branch: string | null;
  /** True when the checkout is a real git repo we can read/update. */
  isGit: boolean;
}

export interface RemoteVersion {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string | null;
  htmlUrl: string;
}

export interface UpdateStatus {
  state: 'idle' | 'running' | 'success' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

/** Walk up from the API's working directory to the repository root (the dir holding .git). */
function findRepoRoot(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const repoRoot = findRepoRoot();
let cachedLocal: LocalVersion | null = null;

export async function getLocalVersion(): Promise<LocalVersion> {
  if (cachedLocal) return cachedLocal;
  if (!repoRoot) {
    cachedLocal = { sha: null, shortSha: null, subject: null, committedAt: null, branch: null, isGit: false };
    return cachedLocal;
  }
  try {
    const { stdout } = await exec('git', ['log', '-1', '--format=%H%x1f%h%x1f%cI%x1f%s'], { cwd: repoRoot });
    const [sha, shortSha, committedAt, subject] = stdout.trim().split('\x1f');
    let branch: string | null = null;
    try {
      const b = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoRoot });
      branch = b.stdout.trim();
    } catch {
      /* detached HEAD or no branch — leave null */
    }
    cachedLocal = {
      sha: sha ?? null,
      shortSha: shortSha ?? null,
      committedAt: committedAt ?? null,
      subject: subject ?? null,
      branch,
      isGit: true,
    };
  } catch {
    cachedLocal = { sha: null, shortSha: null, subject: null, committedAt: null, branch: null, isGit: false };
  }
  return cachedLocal;
}

interface GithubCommit {
  sha: string;
  html_url: string;
  commit: { message: string; committer?: { date?: string } };
}

/** Fetch the latest commit of the tracked branch from GitHub. Returns null on any failure. */
export async function getRemoteVersion(env: Env): Promise<RemoteVersion | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'OpenCoperLock',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/commits/${encodeURIComponent(env.UPDATE_BRANCH)}`,
      { headers, signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) return null;
    const c = (await res.json()) as GithubCommit;
    return {
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      subject: c.commit.message.split('\n')[0] ?? '',
      committedAt: c.commit.committer?.date ?? null,
      htmlUrl: c.html_url,
    };
  } catch {
    return null;
  }
}

/** How many commits the local checkout is behind `head`, via the GitHub compare API. */
export async function commitsBehind(env: Env, base: string, head: string): Promise<number | null> {
  if (base === head) return 0;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'OpenCoperLock',
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/compare/${base}...${head}`,
      { headers, signal: AbortSignal.timeout(12000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { ahead_by?: number };
    return typeof data.ahead_by === 'number' ? data.ahead_by : null;
  } catch {
    return null;
  }
}

const STATUS_FILE = repoRoot ? resolve(repoRoot, '.update-status.json') : null;

export function readUpdateStatus(): UpdateStatus {
  const idle: UpdateStatus = { state: 'idle', startedAt: null, finishedAt: null, message: null };
  if (!STATUS_FILE || !existsSync(STATUS_FILE)) return idle;
  try {
    const raw = JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as Partial<UpdateStatus>;
    return {
      state: raw.state ?? 'idle',
      startedAt: raw.startedAt ?? null,
      finishedAt: raw.finishedAt ?? null,
      message: raw.message ?? null,
    };
  } catch {
    return idle;
  }
}

export interface StartUpdateResult {
  ok: boolean;
  error?: string;
}

/** Spawn the detached self-update script. It survives the PM2 reload it triggers. */
export function startUpdate(env: Env): StartUpdateResult {
  if (!env.SELF_UPDATE_ENABLED) return { ok: false, error: 'Self-update is disabled on this instance.' };
  if (!repoRoot) return { ok: false, error: 'This deployment is not a git checkout; update it manually.' };
  if (readUpdateStatus().state === 'running') return { ok: false, error: 'An update is already running.' };

  const script = join(repoRoot, 'scripts', 'self-update.sh');
  if (!existsSync(script)) return { ok: false, error: 'Update script not found (scripts/self-update.sh).' };

  // Mark running immediately so the UI reflects it before the script writes its own status.
  if (STATUS_FILE) {
    try {
      writeFileSync(
        STATUS_FILE,
        JSON.stringify({ state: 'running', startedAt: new Date().toISOString(), finishedAt: null, message: 'Démarrage…' }),
      );
    } catch {
      /* best effort */
    }
  }

  const child = spawn('bash', [script], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, UPDATE_BRANCH: env.UPDATE_BRANCH },
  });
  child.unref();
  return { ok: true };
}
