/**
 * User-facing build info: the "What's new" dialog shown once per update, to every user (not just
 * admins). The current build is the checked-out git SHA; each user's `lastSeenVersion` records
 * the build they last acknowledged, so we can surface the release notes for everything that
 * changed since — exactly once.
 */
import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { getChangelog, getLocalVersion, getRecentChangelog } from '../services/version.js';

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

    // Notes for seen..current; if `seen` is unreachable (force-push/rebase), fall back to the
    // most recent commits so the user still sees something meaningful.
    const log = (await getChangelog(seen, local.sha)) ?? (await getRecentChangelog(20));
    if (!log) {
      await prisma.user.update({ where: { id: req.user!.id }, data: { lastSeenVersion: local.sha } });
      return { show: false };
    }
    return { show: true, version: local.shortSha, notes: log.markdown, count: log.count };
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
