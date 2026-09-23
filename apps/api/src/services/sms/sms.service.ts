import {
  SMS_TEMPLATES,
  SmsProvider,
  SmsStatus,
  SmsTemplateKey,
  countSmsSegments,
  renderSmsTemplate,
  toE164,
} from '@azf/shared';
import type { Prisma, SmsLog } from '@prisma/client';
import { env } from '../../config/env.js';
import { moduleLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getSmsProvider } from './providers/index.js';

const log = moduleLogger('sms:service');

export interface SendSmsOptions {
  to: string;
  templateKey: SmsTemplateKey;
  variables?: Record<string, string | number>;
  memberId?: string | undefined;
  sentById?: string | undefined;
  /** Override the DLT template ID resolved from env. */
  dltTemplateId?: string | undefined;
  /**
   * When false, the row is written as QUEUED and left for the retry worker.
   * Used by bulk sends so one slow gateway cannot stall an HTTP request.
   */
  immediate?: boolean;
}

/**
 * SMS service.
 *
 * Responsibilities:
 *  • render the DLT-approved template
 *  • persist an SmsLog row BEFORE attempting delivery
 *  • delegate the actual send to the configured provider
 *  • record the outcome, schedule retries with exponential backoff
 *  • park permanently-failed messages in the failed queue for the UI
 *
 * The persist-before-send ordering matters: if the process dies mid-send, the
 * message is recoverable from the queue. The reverse ordering loses it.
 *
 * Nothing here throws on delivery failure. A gateway outage must never roll
 * back the member registration that triggered the welcome SMS.
 */
class SmsService {
  /**
   * Queue and (usually) send one message.
   * Always resolves with the log row, whatever the delivery outcome.
   */
  async send(options: SendSmsOptions): Promise<SmsLog> {
    const {
      to,
      templateKey,
      variables = {},
      memberId,
      sentById,
      dltTemplateId,
      immediate = true,
    } = options;

    const template = SMS_TEMPLATES[templateKey];
    const body = renderSmsTemplate(template.body, variables);
    const { segments } = countSmsSegments(body);
    const e164 = toE164(to);

    const smsLog = await prisma.smsLog.create({
      data: {
        memberId: memberId ?? null,
        toPhone: e164,
        templateKey,
        body,
        variables: variables as Prisma.InputJsonValue,
        provider: providerNameToEnum(getSmsProvider().name),
        status: SmsStatus.QUEUED,
        dltTemplateId: dltTemplateId ?? null,
        maxAttempts: env.SMS_MAX_RETRIES,
        segments,
        sentById: sentById ?? null,
      },
    });

    // The kill switch: rows are still recorded, so turning SMS back on and
    // retrying the queue delivers what was missed.
    if (!env.SMS_ENABLED) {
      log.warn({ smsLogId: smsLog.id }, 'SMS disabled — message queued only');
      return smsLog;
    }

    if (!immediate) return smsLog;

    return this.attemptDelivery(smsLog);
  }

  /**
   * Try to deliver one queued message and record the result.
   * Exported for the retry worker to call on due rows.
   */
  async attemptDelivery(smsLog: SmsLog): Promise<SmsLog> {
    const provider = getSmsProvider();
    const attempt = smsLog.attempts + 1;

    await prisma.smsLog.update({
      where: { id: smsLog.id },
      data: { status: SmsStatus.SENDING, attempts: attempt },
    });

    const result = await provider.send({
      to: smsLog.toPhone,
      body: smsLog.body,
      templateKey: smsLog.templateKey,
      dltTemplateId: smsLog.dltTemplateId ?? undefined,
      variables: (smsLog.variables as Record<string, string | number>) ?? undefined,
      senderId: env.SMS_SENDER_ID,
    });

    if (result.success) {
      log.info(
        { smsLogId: smsLog.id, to: smsLog.toPhone, template: smsLog.templateKey },
        'SMS sent',
      );

      return prisma.smsLog.update({
        where: { id: smsLog.id },
        data: {
          status: result.status,
          providerMessageId: result.providerMessageId,
          rawResponse: result.rawResponse as Prisma.InputJsonValue,
          sentAt: new Date(),
          segments: result.segments,
          errorCode: null,
          errorMessage: null,
          nextRetryAt: null,
        },
      });
    }

    // Failed. Decide between another retry and the dead queue.
    const canRetry =
      attempt < smsLog.maxAttempts && isRetryable(result.errorCode);

    const nextRetryAt = canRetry
      ? new Date(Date.now() + backoffMs(attempt))
      : null;

    log.warn(
      {
        smsLogId: smsLog.id,
        attempt,
        maxAttempts: smsLog.maxAttempts,
        errorCode: result.errorCode,
        willRetry: canRetry,
      },
      'SMS delivery failed',
    );

    return prisma.smsLog.update({
      where: { id: smsLog.id },
      data: {
        status: canRetry ? SmsStatus.FAILED : SmsStatus.DEAD,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        rawResponse: result.rawResponse as Prisma.InputJsonValue,
        failedAt: new Date(),
        nextRetryAt,
      },
    });
  }

  /**
   * Process messages whose retry time has arrived.
   * Called on an interval by the worker; returns how many were handled.
   */
  async processRetryQueue(limit = 50): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    if (!env.SMS_ENABLED) return { processed: 0, succeeded: 0, failed: 0 };

    const due = await prisma.smsLog.findMany({
      where: {
        status: { in: [SmsStatus.QUEUED, SmsStatus.FAILED] },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { queuedAt: 'asc' },
      take: limit,
    });

    let succeeded = 0;
    let failed = 0;

    for (const smsLog of due) {
      // Sequential, not Promise.all: a burst of parallel requests is exactly
      // what gets an account rate-limited by the gateway.
      const updated = await this.attemptDelivery(smsLog);
      if (
        updated.status === SmsStatus.SENT ||
        updated.status === SmsStatus.DELIVERED
      ) {
        succeeded++;
      } else {
        failed++;
      }
    }

    if (due.length > 0) {
      log.info({ processed: due.length, succeeded, failed }, 'Retry queue processed');
    }

    return { processed: due.length, succeeded, failed };
  }

  /** Manually retry a dead message from the failed-SMS UI. */
  async retryMessage(smsLogId: string): Promise<SmsLog> {
    const smsLog = await prisma.smsLog.findUniqueOrThrow({
      where: { id: smsLogId },
    });

    // Give it a fresh budget; the operator has presumably fixed the cause.
    const reset = await prisma.smsLog.update({
      where: { id: smsLogId },
      data: {
        status: SmsStatus.QUEUED,
        attempts: 0,
        maxAttempts: Math.max(smsLog.maxAttempts, env.SMS_MAX_RETRIES),
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
        failedAt: null,
      },
    });

    return this.attemptDelivery(reset);
  }

  /**
   * Poll the provider for delivery confirmations on messages we sent but
   * have not yet seen delivered.
   */
  async syncDeliveryStatuses(limit = 100): Promise<number> {
    const provider = getSmsProvider();
    if (!provider.getStatus) return 0;

    const pending = await prisma.smsLog.findMany({
      where: {
        status: SmsStatus.SENT,
        providerMessageId: { not: null },
        sentAt: {
          // Providers stop reporting on old messages; after a day, treat SENT
          // as the final state rather than polling forever.
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      take: limit,
      orderBy: { sentAt: 'asc' },
    });

    let updated = 0;

    for (const smsLog of pending) {
      if (!smsLog.providerMessageId) continue;

      const status = await provider.getStatus(smsLog.providerMessageId);

      if (status.delivered) {
        await prisma.smsLog.update({
          where: { id: smsLog.id },
          data: {
            status: SmsStatus.DELIVERED,
            deliveredAt: status.deliveredAt ?? new Date(),
          },
        });
        updated++;
      } else if (status.errorCode && status.status !== 'UNKNOWN') {
        await prisma.smsLog.update({
          where: { id: smsLog.id },
          data: {
            status: SmsStatus.DEAD,
            errorCode: status.errorCode,
            errorMessage: status.errorMessage ?? null,
            failedAt: new Date(),
          },
        });
        updated++;
      }
    }

    return updated;
  }
}

/**
 * Exponential backoff with jitter: 1min, 2min, 4min, ...
 * The jitter prevents a batch of messages that failed together from all
 * retrying in the same instant and hammering a recovering gateway.
 */
function backoffMs(attempt: number): number {
  const base = env.SMS_RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * base;
  return Math.min(base + jitter, 60 * 60 * 1000);
}

/**
 * Retrying a permanently-rejected message wastes the SMS credits it costs.
 * An invalid number or a DND block will fail identically every time; a
 * timeout or a 5xx will not.
 */
const PERMANENT_ERROR_CODES = new Set([
  'INVALID_NUMBER',
  'DND_BLOCKED',
  'MISSING_DLT_TEMPLATE',
  'HTTP_400',
  'HTTP_401',
  'HTTP_403',
  'HTTP_404',
  'HTTP_422',
]);

function isRetryable(errorCode: string | null): boolean {
  if (!errorCode) return true;
  return !PERMANENT_ERROR_CODES.has(errorCode);
}

function providerNameToEnum(name: string): SmsProvider {
  switch (name) {
    case 'MSG91':
      return SmsProvider.MSG91;
    case 'TWILIO':
      return SmsProvider.TWILIO;
    case 'FAST2SMS':
      return SmsProvider.FAST2SMS;
    default:
      return SmsProvider.MOCK;
  }
}

export const smsService = new SmsService();
