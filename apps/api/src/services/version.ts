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

// Trailer / footer lines we never want to show end users in the "What's new" notes.
const NOISE_LINE = /^(Co-Authored-By|Claude-Session|Claude-[\w-]+|Signed-off-by|Reviewed-by):/i;

/** Strip bookkeeping trailers and the generator footer from a commit body. */
function cleanBody(body: string): string {
  return body
    .split('\n')
    .filter((l) => !NOISE_LINE.test(l.trim()) && !/^🤖 Generated with/.test(l.trim()) && !/^https:\/\/claude\.ai/.test(l.trim()))
    .join('\n')
    .trim();
}

export interface Changelog {
  /** Markdown ready to render in the "What's new" dialog. */
  markdown: string;
  /** Number of commits summarised (after capping). */
  count: number;
}

// Beyond this many commits the notes get unwieldy; we summarise the newest and note the rest.
const MAX_CHANGELOG_COMMITS = 40;

/**
 * Build human-readable release notes for the commits in `from..to` (newest first), as Markdown.
 * Returns null when there is nothing to show or git can't produce a range (e.g. a force-push made
 * `from` unreachable — the caller falls back to the most recent commits instead).
 */
export async function getChangelog(from: string, to: string): Promise<Changelog | null> {
  if (!repoRoot || from === to) return null;
  // %x1e separates commits, %x1f separates subject from body within a commit.
  const fmt = '--format=%s%x1f%b%x1e';
  let stdout: string;
  try {
    const res = await exec('git', ['log', fmt, `${from}..${to}`], { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 });
    stdout = res.stdout;
  } catch {
    return null; // `from` not reachable — caller decides on a fallback
  }
  return renderChangelog(stdout);
}

/** The most recent `n` commits as Markdown — a fallback when the range can't be computed. */
export async function getRecentChangelog(n: number): Promise<Changelog | null> {
  if (!repoRoot) return null;
  try {
    const { stdout } = await exec('git', ['log', `-${n}`, '--format=%s%x1f%b%x1e'], { cwd: repoRoot, maxBuffer: 8 * 1024 * 1024 });
    return renderChangelog(stdout);
  } catch {
    return null;
  }
}

function renderChangelog(raw: string): Changelog | null {
  const commits = raw
    .split('\x1e')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [subject, ...rest] = c.split('\x1f');
      return { subject: (subject ?? '').trim(), body: cleanBody(rest.join('\x1f')) };
    })
    .filter((c) => c.subject);
  if (commits.length === 0) return null;

  const shown = commits.slice(0, MAX_CHANGELOG_COMMITS);
  const blocks = shown.map((c) => (c.body ? `### ${c.subject}\n\n${c.body}` : `### ${c.subject}`));
  if (commits.length > shown.length) {
    blocks.push(`_…and ${commits.length - shown.length} more change(s)._`);
  }
  return { markdown: blocks.join('\n\n'), count: commits.length };
}

export interface HistoryCommit {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string | null;
}

/** The most recent commits on the current checkout (newest first) — rollback candidates. */
export async function getVersionHistory(n = 15): Promise<HistoryCommit[]> {
  if (!repoRoot) return [];
  try {
    const { stdout } = await exec('git', ['log', `-${n}`, '--format=%H%x1f%h%x1f%cI%x1f%s'], { cwd: repoRoot });
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, shortSha, committedAt, subject] = l.split('\x1f');
        return { sha: sha ?? '', shortSha: shortSha ?? '', committedAt: committedAt || null, subject: subject ?? '' };
      });
  } catch {
    return [];
  }
}

/** True when `ancestor` is an ancestor of `descendant` (git merge-base --is-ancestor exit 0). */
export async function isAncestor(ancestor: string, descendant: string): Promise<boolean> {
  if (!repoRoot) return false;
  try {
    await exec('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
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

// A real update never takes this long; a "running" status older than this is stuck (e.g. an old
// build that was killed before the reparent fix) and must not lock out future updates forever.
const STALE_RUNNING_MS = 10 * 60 * 1000;

/** True when the status is "running" but so old it's clearly stuck, not actually in progress. */
export function isUpdateStuck(status: UpdateStatus): boolean {
  return status.state === 'running' && status.startedAt !== null && Date.now() - Date.parse(status.startedAt) > STALE_RUNNING_MS;
}

/**
 * Spawn the detached self-update script. It survives the PM2 reload it triggers. When `targetRef`
 * is given, the checkout is reset to THAT commit (a rollback to a previous version) instead of the
 * latest on the tracked branch — the build/health-check/auto-rollback safety net is identical.
 */
export function startUpdate(env: Env, targetRef?: string): StartUpdateResult {
  if (!env.SELF_UPDATE_ENABLED) return { ok: false, error: 'Self-update is disabled on this instance.' };
  if (!repoRoot) return { ok: false, error: 'This deployment is not a git checkout; update it manually.' };
  const current = readUpdateStatus();
  // A genuinely in-progress update blocks a second one; a stuck/stale one does not.
  if (current.state === 'running' && !isUpdateStuck(current)) {
    return { ok: false, error: 'An update is already running.' };
  }

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

  // Spawn the updater so it OUTLIVES the PM2 reload it will trigger. PM2 restarts a process by
  // tree-killing its descendants, so the script must NOT stay a child of this API process —
  // otherwise reloading the API kills the updater mid-flight (freezing the status at "verifying").
  // We launch it from a throwaway `bash -c` that backgrounds the real script and exits at once;
  // once that shell exits the script is reparented to init (ppid 1), and `setsid` detaches it
  // from our session/process-group, so the reload can no longer reap it.
  const q = (s: string) => `'${s.split("'").join("'\\''")}'`;
  const run = `bash ${q(script)} </dev/null >>${q(join(repoRoot, '.update.log'))} 2>&1 &`;
  const launch = `if command -v setsid >/dev/null 2>&1; then setsid ${run} else ${run} fi`;
  const child = spawn('bash', ['-c', launch], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, UPDATE_BRANCH: env.UPDATE_BRANCH, ...(targetRef ? { UPDATE_TARGET_REF: targetRef } : {}) },
  });
  child.unref();
  return { ok: true };
}
