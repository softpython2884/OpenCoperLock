/**
 * PM2 process definition for a bare-metal / dedicated-server deployment.
 *
 *   pnpm install
 *   ./scripts/deploy.sh          # build, migrate, seed
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup      # persist across reboots
 *
 * Secrets live in the repo-root `.env` (copied from `.env.example`). The API process
 * loads that file itself (apps/api/src/config/dotenv.ts). For the web process we read a
 * couple of values here so PORT/HOSTNAME are honoured no matter how PM2 is invoked.
 */
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;

/** Minimal, dependency-free .env reader (KEY=VALUE, ignores comments/blank lines). */
function readEnv(file) {
  const out = {};
  try {
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[line.slice(0, eq).trim()] = value;
    }
  } catch {
    /* no .env yet — fall back to defaults below */
  }
  return out;
}

const env = readEnv(path.join(root, '.env'));

// If a project-local PostgreSQL cluster exists (created by scripts/postgres-local.sh on a
// random port), let PM2 supervise it too, ahead of the API.
const hasLocalPostgres = fs.existsSync(path.join(root, '.postgres', 'data', 'PG_VERSION'));
const localPostgresApp = {
  name: 'opencoperlock-postgres',
  cwd: root,
  script: 'scripts/postgres-local.sh',
  args: 'start',
  interpreter: 'bash',
  autorestart: true,
  max_restarts: 10,
};

module.exports = {
  apps: [
    ...(hasLocalPostgres ? [localPostgresApp] : []),
    {
      name: 'opencoperlock-api',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork', // the in-process Remote-Upload worker must be a single instance
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      kill_timeout: 10000, // give in-flight uploads / graceful shutdown time
    },
    {
      name: 'opencoperlock-web',
      cwd: path.join(root, 'apps/web'),
      script: '.next/standalone/apps/web/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: env.WEB_PORT || process.env.WEB_PORT || 3000,
        // Bound to localhost when WEB_HOST=127.0.0.1 (set by the wizard when behind nginx).
        HOSTNAME: env.WEB_HOST || process.env.WEB_HOST || '0.0.0.0',
      },
      max_memory_restart: '512M',
    },
  ],
};
