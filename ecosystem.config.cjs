/**
 * PM2 process definition for a bare-metal / dedicated-server deployment.
 *
 *   pnpm install
 *   ./scripts/deploy.sh          # build, migrate, seed
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup      # persist across reboots
 *
 * Secrets live in the repo-root `.env` (copied from `.env.example`). The API loads that
 * file itself (see apps/api/src/config/dotenv.ts), so no secrets are embedded here.
 * The web process only needs PORT/HOSTNAME — its API URL is baked at build time via
 * NEXT_PUBLIC_API_URL (see scripts/deploy.sh and docs/DEPLOYMENT.md).
 */
const path = require('node:path');
const root = __dirname;

module.exports = {
  apps: [
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
        PORT: process.env.WEB_PORT || 3000,
        // Bind all interfaces by default; set WEB_HOST=127.0.0.1 when behind a reverse proxy.
        HOSTNAME: process.env.WEB_HOST || '0.0.0.0',
      },
      max_memory_restart: '512M',
    },
  ],
};
