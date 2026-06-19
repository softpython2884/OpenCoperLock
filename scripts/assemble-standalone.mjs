/**
 * Assemble a self-contained Next.js standalone bundle.
 *
 * `output: 'standalone'` emits a minimal server under `.next/standalone`, but the
 * static assets (`.next/static`) and `public/` are intentionally left out so they can
 * be served from a CDN. For a single-box PM2 / bare-metal deploy we just copy them in,
 * so `node apps/web/.next/standalone/apps/web/server.js` serves everything by itself.
 *
 * Runs automatically as the web app's `postbuild` step; safe to re-run.
 */
import { cp, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');
const standaloneWeb = join(webRoot, '.next', 'standalone', 'apps', 'web');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(join(webRoot, '.next', 'standalone')))) {
    console.error('[assemble-standalone] no standalone output found — run the web build first.');
    process.exit(1);
  }

  // .next/static -> standalone/apps/web/.next/static
  await cp(join(webRoot, '.next', 'static'), join(standaloneWeb, '.next', 'static'), {
    recursive: true,
  });

  // public/ -> standalone/apps/web/public (if the app has a public dir)
  if (await exists(join(webRoot, 'public'))) {
    await cp(join(webRoot, 'public'), join(standaloneWeb, 'public'), { recursive: true });
  }

  console.log('[assemble-standalone] standalone bundle assembled.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
