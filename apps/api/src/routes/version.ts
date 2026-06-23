/**
 * User-facing build info: the "What's new" dialog shown once per update, to every user (not just
 * admins). The current build is the checked-out git SHA; each user's `lastSeenVersion` records
 * the build they last acknowledged, so we can surface the release notes for everything that
 * changed since — exactly once.
 */
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { getChangelog, getLocalVersion, getRecentChangelog, isAncestor } from '../services/version.js';

export const versionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAuth);

  // GET /version/whats-new — release notes since the user's last acknowledged build, or
  // { show: false } when there is nothing new (or this isn't a git deployment).
  app.get('/whats-new', async (req) => {
    const local = await getLocalVersion();
    if (!local.isGit || !local.sha) return { show: false };

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { lastSeenVersion: true },
    });
    const seen = user.lastSeenVersion;

    // First contact (new user, or upgrading from before this feature): remember the current
    // build silently so we never dump the entire project history on them.
    if (!seen) {
      await prisma.user.update({ where: { id: req.user!.id }, data: { lastSeenVersion: local.sha } });
      return { show: false };
    }
    if (seen === local.sha) return { show: false };

    // If the current build is an ancestor of what the user last saw, the deployment was rolled
    // BACK — there is nothing "new" to announce, so just record the build silently.
    if (await isAncestor(local.sha, seen)) {
      await prisma.user.update({ where: { id: req.user!.id }, data: { lastSeenVersion: local.sha } });
      return { show: false };
    }

    // Notes for seen..current; if `seen` is unreachable (force-push/rebase), fall back to the
    // most recent commits so the user still sees something meaningful.
    const ranged = await getChangelog(seen, local.sha);
    const log = ranged ?? (await getRecentChangelog(20));
    if (!log) {
      await prisma.user.update({ where: { id: req.user!.id }, data: { lastSeenVersion: local.sha } });
      return { show: false };
    }
    // A link to the full detail on GitHub: the compare view (every commit + diff since the user's
    // last build) when we have a real range, else the current commit when we fell back.
    const repo = app.ctx.env.GITHUB_REPO;
    const githubUrl = repo
      ? ranged
        ? `https://github.com/${repo}/compare/${seen}...${local.sha}`
        : `https://github.com/${repo}/commit/${local.sha}`
      : null;
    return { show: true, version: local.shortSha, entries: log.entries, count: log.count, githubUrl };
  });

  // POST /version/whats-new/seen — dismiss the dialog for the current build.
  app.post('/whats-new/seen', async (req) => {
    const local = await getLocalVersion();
    if (local.sha) {
      await prisma.user.update({ where: { id: req.user!.id }, data: { lastSeenVersion: local.sha } });
    }
    return { ok: true };
  });
};
