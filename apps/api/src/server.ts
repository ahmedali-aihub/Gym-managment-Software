import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { connectDatabase, disconnectDatabase } from './lib/prisma.js';
import { membersService } from './modules/members/members.service.js';
import { emailService } from './services/email/email.service.js';
import { verifyEmailProvider } from './services/email/providers/index.js';
import { verifyWhatsAppProvider } from './services/whatsapp/providers/index.js';
import { whatsappService } from './services/whatsapp/whatsapp.service.js';
import { ensurePhotoBucket } from './services/storage/supabase-storage.js';
import { verifySmsProvider } from './services/sms/providers/index.js';
import { smsService } from './services/sms/sms.service.js';
import { ensureUploadDirectories } from './services/storage/photo.service.js';

/**
 * Background workers.
 *
 * Run in-process on timers rather than as a separate queue service. For a
 * single-branch gym this is the right trade: no Redis to operate, no extra
 * deployment target. If the gym grows to several branches (Phase 4), these
 * move to a proper scheduler.
 */
const SMS_RETRY_INTERVAL_MS = 60_000;
const STATUS_SYNC_INTERVAL_MS = 5 * 60_000;
const EXPIRY_SYNC_INTERVAL_MS = 60 * 60_000;

const timers: NodeJS.Timeout[] = [];

function startBackgroundWorkers(): void {
  timers.push(
    setInterval(() => {
      void smsService.processRetryQueue().catch((error: unknown) => {
        logger.error({ err: error }, 'SMS retry worker failed');
      });
    }, SMS_RETRY_INTERVAL_MS),
  );

  timers.push(
    setInterval(() => {
      void smsService.syncDeliveryStatuses().catch((error: unknown) => {
        logger.error({ err: error }, 'SMS status sync failed');
      });
    }, STATUS_SYNC_INTERVAL_MS),
  );

  // Email and WhatsApp retry on the same cadence as SMS. Without these, a
  // message that failed once — a Gmail hiccup, a rate limit — sat in the
  // queue as FAILED forever and the member simply never heard from the gym.
  timers.push(
    setInterval(() => {
      void emailService.processRetryQueue().catch((error: unknown) => {
        logger.error({ err: error }, 'Email retry worker failed');
      });
    }, SMS_RETRY_INTERVAL_MS),
  );

  timers.push(
    setInterval(() => {
      void whatsappService.processRetryQueue().catch((error: unknown) => {
        logger.error({ err: error }, 'WhatsApp retry worker failed');
      });
    }, SMS_RETRY_INTERVAL_MS),
  );

  // Without this, "active members" silently includes everyone whose
  // membership lapsed overnight, and every KPI built on it is wrong.
  timers.push(
    setInterval(() => {
      void membersService.syncExpiredStatuses().catch((error: unknown) => {
        logger.error({ err: error }, 'Membership expiry sync failed');
      });
    }, EXPIRY_SYNC_INTERVAL_MS),
  );

  logger.info('Background workers started');
}

async function bootstrap(): Promise<void> {
  await connectDatabase();
  await ensureUploadDirectories();
  await verifySmsProvider();
  await verifyEmailProvider();
  await verifyWhatsAppProvider();
  await ensurePhotoBucket();

  const app = createApp();

  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      `A to Z Fitness API listening on http://localhost:${env.PORT} [${env.NODE_ENV}]`,
    );
  });

  startBackgroundWorkers();

  // Reconcile once at boot rather than waiting an hour for the first tick.
  void membersService.syncExpiredStatuses().catch((error: unknown) => {
    logger.error({ err: error }, 'Initial expiry sync failed');
  });

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests
   * finish, then close the database. Killing the process mid-transaction is
   * how half-written payments happen.
   */
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);

    for (const timer of timers) clearInterval(timer);

    server.close(() => {
      void disconnectDatabase().finally(() => {
        logger.info('Shutdown complete');
        process.exit(0);
      });
    });

    // Do not hang forever on a stuck connection.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

void bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start the server');
  process.exit(1);
});
