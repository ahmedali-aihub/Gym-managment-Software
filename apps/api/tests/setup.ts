/**
 * Test environment bootstrap.
 *
 * Runs before any test module is imported, so the env validation in
 * config/env.ts sees a complete configuration and does not process.exit(1).
 *
 * These are deliberately fake values. Tests never reach a real database, a
 * real SMS gateway, or a real payment provider — the Prisma client and the
 * SMS provider are both substituted with in-memory fakes.
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  'postgresql://test:test@localhost:5432/test?schema=public';
process.env.DIRECT_URL =
  'postgresql://test:test@localhost:5432/test?schema=public';

// Long enough to satisfy the 32-character minimum, and distinct from each
// other so the "secrets must differ" check passes.
process.env.JWT_ACCESS_SECRET =
  'test-access-secret-that-is-long-enough-for-validation-0001';
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-that-is-long-enough-for-validation-0002';

// Fewer bcrypt rounds: 12 rounds would add minutes across a suite.
process.env.BCRYPT_ROUNDS = '10';

process.env.SMS_PROVIDER = 'mock';
process.env.SMS_ENABLED = 'true';
process.env.SMS_MAX_RETRIES = '3';
process.env.SMS_RETRY_BACKOFF_MS = '1000';

process.env.PAYMENT_PROVIDER = 'mock';

// A to Z Fitness is not GST registered; receipts carry no tax component.
process.env.GST_REGISTERED = 'false';

process.env.GYM_NAME = 'A to Z Fitness';
process.env.GYM_PHONE = '+91 90000 00000';
