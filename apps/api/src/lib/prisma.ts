import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env, isDevelopment, isTest } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Prisma client singleton.
 *
 * In development, tsx's watch mode re-executes this module on every file
 * change. Without caching on globalThis, each reload opens a fresh connection
 * pool and Supabase's connection limit is exhausted within a few saves.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Prisma 7 requires an explicit driver adapter. The pooled DATABASE_URL is
  // correct here: the app runs through Supabase's transaction pooler, while
  // migrations use DIRECT_URL via prisma.config.ts.
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  const client = new PrismaClient({
    adapter,
    log: isDevelopment
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
  });

  if (isDevelopment && !isTest) {
    client.$on('query' as never, (e: { query: string; duration: number }) => {
      // Only surface slow queries; logging every one drowns the console.
      if (e.duration > 200) {
        logger.warn(
          { durationMs: e.duration, query: e.query.slice(0, 200) },
          'Slow query',
        );
      }
    });
  }

  client.$on('warn' as never, (e: { message: string }) => {
    logger.warn({ prisma: e.message }, 'Prisma warning');
  });

  client.$on('error' as never, (e: { message: string }) => {
    logger.error({ prisma: e.message }, 'Prisma error');
  });

  return client;
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (isDevelopment) globalForPrisma.prisma = prisma;

/** Verify connectivity at boot so a bad DATABASE_URL fails loudly. */
export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

/** Prisma error codes worth handling explicitly. */
export const PrismaErrorCode = {
  UNIQUE_CONSTRAINT: 'P2002',
  FOREIGN_KEY_CONSTRAINT: 'P2003',
  RECORD_NOT_FOUND: 'P2025',
  VALUE_TOO_LONG: 'P2000',
} as const;

export function isPrismaError(
  error: unknown,
  code: string,
): error is { code: string; meta?: { target?: string[] } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}
