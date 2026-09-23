import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The CLI runs outside the app, so it loads the root .env itself.
loadDotenv({ path: path.resolve(__dirname, '../../.env') });

/**
 * Prisma CLI configuration.
 *
 * As of Prisma 7, connection URLs live here rather than in schema.prisma.
 *
 * Two URLs are needed against Supabase:
 *   • DIRECT_URL (port 5432) — migrations. The transaction pooler cannot run
 *     them, because it does not support the prepared statements DDL requires.
 *   • DATABASE_URL (port 6543) — the running application, via the pooler.
 *
 * Migrations therefore use the direct connection, falling back to
 * DATABASE_URL when DIRECT_URL is not configured.
 */
export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),

  migrations: {
    path: path.join(__dirname, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },

  datasource: {
    // env() throws on a missing variable, so the optional ones are read
    // straight from process.env.
    url: process.env.DIRECT_URL || env('DATABASE_URL'),
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
