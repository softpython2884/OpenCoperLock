/**
 * Optional automatic self-update. When an admin enables it (Setting.autoUpdateEnabled) and the
 * deployment allows self-update, the instance checks GitHub a few times a day and applies a newer
 * build automatically — using the same health-checked, auto-rollback self-update path as the
 * manual button. Off by default: auto-applying code is opt-in.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { AppContext } from '../context.js';
import { prisma } from '../db.js';
import { getLocalVersion, getRemoteVersion, isUpdateStuck, readUpdateStatus, startUpdate } from './version.js';

// Check a few times a day — frequent enough to pick up releases promptly, light on the GitHub
// rate limit. The first check runs shortly after boot.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const KICKOFF_MS = 5 * 60 * 1000;
// After a failed update, wait a day before trying again so a persistent failure can't loop.
const FAILED_BACKOFF_MS = 24 * 60 * 60 * 1000;

export async function autoUpdateTick(ctx: AppContext, log: FastifyBaseLogger): Promise<void> {
  if (!ctx.env.SELF_UPDATE_ENABLED) return;
  const setting = await prisma.setting
    .findUnique({ where: { id: 'global' }, select: { autoUpdateEnabled: true } })
    .catch(() => null);
  if (!setting?.autoUpdateEnabled) return;

  const status = readUpdateStatus();
  if (status.state === 'running' && !isUpdateStuck(status)) return; // already updating
  if (status.state === 'failed' && status.finishedAt && Date.now() - Date.parse(status.finishedAt) < FAILED_BACKOFF_MS) {
    return; // a recent failure needs a human look before we retry
  }

  const local = await getLocalVersion();
  if (!local.isGit || !local.sha) return;
  const remote = await getRemoteVersion(ctx.env);
  if (!remote || remote.sha === local.sha) return; // up to date or GitHub unreachable

  log.info({ from: local.shortSha, to: remote.shortSha }, 'auto-update: newer build available — applying');
  const res = startUpdate(ctx.env);
  if (!res.ok) log.warn({ error: res.error }, 'auto-update: could not start');
}

/** Schedule the periodic auto-update check. Returns a stop function for graceful shutdown. */
export function startAutoUpdate(ctx: AppContext, log: FastifyBaseLogger): () => void {
  let stopped = false;
  const run = () => {
    if (!stopped) void autoUpdateTick(ctx, log).catch((err) => log.error({ err }, 'auto-update tick failed'));
  };
  const timer = setInterval(run, CHECK_INTERVAL_MS);
  const kickoff = setTimeout(run, KICKOFF_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
