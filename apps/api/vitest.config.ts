import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Money and SMS tests touch shared module state; keep them deterministic.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    /**
     * 20s rather than Vitest's 5s default.
     *
     * The HTTP smoke suite boots the entire Express app — nine route modules,
     * Prisma client, middleware — inside `beforeAll`. Alone that takes ~3s,
     * but every suite shares one fork (see singleFork above), so under load
     * it exceeded 5s and the whole file was silently SKIPPED rather than
     * failed. A skipped suite reports green, which is worse than a red one.
     */
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts', 'src/server.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
