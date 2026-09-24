import {
  WHATSAPP_TEMPLATES,
  WhatsAppStatus,
  WhatsAppTemplateKey,
  renderWhatsAppTemplate,
  toE164,
  toWhatsAppParameters,
} from '@azf/shared';
import type { Prisma, WhatsAppLog } from '@prisma/client';
import { gymConfig, whatsappConfig } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { moduleLogger } from '../../lib/logger.js';
import { getWhatsAppProvider } from './providers/index.js';

const log = moduleLogger('whatsapp');

export interface SendWhatsAppOptions {
  to: string;
  templateKey: WhatsAppTemplateKey;
  variables?: Record<string, string | number>;
  memberId?: string;
  sentById?: string;
  /** False queues without sending — the retry worker picks it up. */
  immediate?: boolean;
}

/**
 * WhatsApp delivery.
 *
 * Deliberately shaped like the SMS and email services:
 *
 *  • render the template, persist a log row FIRST, then attempt delivery
 *  • record the outcome and schedule retries with exponential backoff
 *  • park permanently-failed messages for the failed-queue view
 *
 * NOTHING HERE THROWS on delivery failure. A member standing at the desk has
 * paid; losing their notification is recoverable, losing the payment is not.
 */
class WhatsAppService {
  /**
   * Queue and (usually) send one message.
   * Always resolves with the log row, whatever the delivery outcome.
   */
  async send(options: SendWhatsAppOptions): Promise<WhatsAppLog> {
    const {
      to,
      templateKey,
      variables = {},
      memberId,
      sentById,
      immediate = true,
    } = options;

    const template = WHATSAPP_TEMPLATES[templateKey];

    // Gym identity is merged here rather than asked of every caller — every
    // template needs it and no caller should have to remember.
    const merged: Record<string, string | number> = {
      gymName: gymConfig.name,
      gymPhone: gymConfig.phone,
      ...variables,
    };

    const body = renderWhatsAppTemplate(template, merged);
    const e164 = toE164(to);

    const whatsappLog = await prisma.whatsAppLog.create({
      data: {
        memberId: memberId ?? null,
        toPhone: e164,
        templateKey,
        body,
        variables: merged as Prisma.InputJsonValue,
        metaTemplateName: template.metaName,
        provider: providerNameToEnum(getWhatsAppProvider().name),
        status: WhatsAppStatus.QUEUED,
        maxAttempts: whatsappConfig.maxRetries,
        sentById: sentById ?? null,
      },
    });

    // The kill switch: rows are still recorded, so turning WhatsApp back on
    // and retrying the queue delivers what was missed.
    if (!whatsappConfig.enabled) {
      log.warn(
        { whatsappLogId: whatsappLog.id },
        'WhatsApp disabled — message queued only',
      );
      return whatsappLog;
    }

    if (!immediate) return whatsappLog;

    return this.attemptDelivery(whatsappLog);
  }

  /**
   * Try to deliver one queued message and record the result.
   * Exported for the retry worker to call on due rows.
   */
  async attemptDelivery(whatsappLog: WhatsAppLog): Promise<WhatsAppLog> {
    const provider = getWhatsAppProvider();
    const attempt = whatsappLog.attempts + 1;

    await prisma.whatsAppLog.update({
      where: { id: whatsappLog.id },
      data: { status: WhatsAppStatus.SENDING, attempts: attempt },
    });

    const template = WHATSAPP_TEMPLATES[whatsappLog.templateKey];
    const variables = (whatsappLog.variables ?? {}) as Record<
      string,
      string | number
    >;

    const result = await provider.send({
      to: whatsappLog.toPhone,
      templateKey: whatsappLog.templateKey,
      metaTemplateName: whatsappLog.metaTemplateName ?? template.metaName,
      parameters: toWhatsAppParameters(template, variables),
      body: whatsappLog.body,
      languageCode: whatsappConfig.languageCode,
    });

    if (result.success) {
      return prisma.whatsAppLog.update({
        where: { id: whatsappLog.id },
        data: {
          status: WhatsAppStatus.SENT,
          sentAt: new Date(),
          providerMessageId: result.providerMessageId ?? null,
          rawResponse: (result.rawResponse ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          errorCode: null,
          errorMessage: null,
          nextRetryAt: null,
        },
      });
    }

    // A permanent failure retried is quota burnt for a result that cannot
    // change; park it so the owner sees it in the failed queue.
    const exhausted = attempt >= whatsappLog.maxAttempts;
    const permanent = result.retryable === false;
    const dead = exhausted || permanent;

    if (dead) {
      log.error(
        {
          whatsappLogId: whatsappLog.id,
          code: result.errorCode,
          attempts: attempt,
          permanent,
        },
        'WhatsApp message failed permanently',
      );
    }

    return prisma.whatsAppLog.update({
      where: { id: whatsappLog.id },
      data: {
        status: dead ? WhatsAppStatus.DEAD : WhatsAppStatus.FAILED,
        failedAt: new Date(),
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        rawResponse: (result.rawResponse ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        // Exponential backoff: a rate-limited API needs longer each time,
        // and hammering it makes the limit worse.
        nextRetryAt: dead
          ? null
          : new Date(
              Date.now() +
                whatsappConfig.retryBackoffMs * Math.pow(2, attempt - 1),
            ),
      },
    });
  }

  /** Rows due for another attempt, oldest first. */
  /** Manually retry a failed WhatsApp message from the Messages UI. */
  async retryMessage(whatsappLogId: string): Promise<WhatsAppLog> {
    const whatsappLog = await prisma.whatsAppLog.findUniqueOrThrow({
      where: { id: whatsappLogId },
    });

    // Give it a fresh budget; the operator has presumably fixed the cause.
    const reset = await prisma.whatsAppLog.update({
      where: { id: whatsappLogId },
      data: {
        status: WhatsAppStatus.QUEUED,
        attempts: 0,
        maxAttempts: Math.max(
          whatsappLog.maxAttempts,
          whatsappConfig.maxRetries,
        ),
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
        failedAt: null,
      },
    });

    return this.attemptDelivery(reset);
  }

  async getRetryable(limit = 25): Promise<WhatsAppLog[]> {
    return prisma.whatsAppLog.findMany({
      where: {
        status: WhatsAppStatus.FAILED,
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { nextRetryAt: 'asc' },
      take: limit,
    });
  }

  /** Process the due retry queue. Called by the worker. */
  async processRetryQueue(): Promise<{ attempted: number; sent: number }> {
    const due = await this.getRetryable();
    let sent = 0;

    for (const row of due) {
      const updated = await this.attemptDelivery(row);
      if (updated.status === WhatsAppStatus.SENT) sent++;
    }

    return { attempted: due.length, sent };
  }
}

function providerNameToEnum(name: string) {
  return name === 'meta' ? ('META' as const) : ('MOCK' as const);
}

export const whatsappService = new WhatsAppService();
