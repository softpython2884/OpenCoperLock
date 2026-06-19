import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests share one Postgres database; run files serially to avoid races.
    fileParallelism: false,
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
