import {
  EMAIL_TEMPLATES,
  EmailStatus,
  EmailTemplateKey,
  renderEmailTemplate,
} from '@azf/shared';
import type { EmailLog, Prisma } from '@prisma/client';
import { emailConfig, env, gymConfig } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { moduleLogger } from '../../lib/logger.js';
import { generateReceiptPdf } from '../pdf/receipt.service.js';
import {
  getEmailProvider,
  type EmailAttachment,
} from './providers/index.js';

const log = moduleLogger('email');

export interface SendEmailOptions {
  to: string;
  templateKey: EmailTemplateKey;
  variables?: Record<string, string | number>;
  memberId?: string;
  sentById?: string;
  /** Invoice whose receipt PDF to attach. */
  attachInvoiceId?: string;
  /** False queues without sending — the retry worker picks it up. */
  immediate?: boolean;
}

/**
 * Email delivery.
 *
 * Deliberately shaped like the SMS service:
 *
 *  • render the template, persist a log row FIRST, then attempt delivery
 *  • record the outcome and schedule retries with exponential backoff
 *  • park permanently-failed messages for the failed-queue view
 *
 * The persist-before-send ordering matters: if the process dies mid-send the
 * message is recoverable from the queue, where the reverse ordering loses it.
 *
 * NOTHING HERE THROWS on delivery failure. A mail outage must never roll back
 * the member registration that triggered the welcome email — the member is
 * standing at the desk, and the registration is the thing that matters.
 */
class EmailService {
  /**
   * Queue and (usually) send one message.
   * Always resolves with the log row, whatever the delivery outcome.
   */
  async send(options: SendEmailOptions): Promise<EmailLog> {
    const {
      to,
      templateKey,
      variables = {},
      memberId,
      sentById,
      attachInvoiceId,
      immediate = true,
    } = options;

    const template = EMAIL_TEMPLATES[templateKey];

    // Gym identity is merged in here rather than asked of every caller —
    // every template needs it and no caller should have to remember.
    const merged: Record<string, string | number> = {
      gymName: gymConfig.name,
      gymAddress: [gymConfig.addressLine1, gymConfig.addressLine2]
        .filter(Boolean)
        .join(', '),
      gymPhone: gymConfig.phone,
      gymEmail: gymConfig.email,
      ...variables,
    };

    const subject = renderEmailTemplate(template.subject, merged, false);
    const html = renderEmailTemplate(template.body, merged);
    // The plain-text part is rendered at delivery time by textFromLog, from
    // the same stored variables — see the note there on why it is not
    // persisted alongside the HTML.

    const emailLog = await prisma.emailLog.create({
      data: {
        memberId: memberId ?? null,
        toEmail: to.trim().toLowerCase(),
        templateKey,
        subject,
        body: html,
        variables: merged as Prisma.InputJsonValue,
        provider: providerNameToEnum(getEmailProvider().name),
        status: EmailStatus.QUEUED,
        maxAttempts: env.EMAIL_MAX_RETRIES,
        attachments: attachInvoiceId
          ? ({ invoiceId: attachInvoiceId } as Prisma.InputJsonValue)
          : undefined,
        sentById: sentById ?? null,
      },
    });

    // The kill switch: rows are still recorded, so turning email back on and
    // retrying the queue delivers what was missed.
    if (!emailConfig.enabled) {
      log.warn(
        { emailLogId: emailLog.id },
        'Email disabled — message queued only',
      );
      return emailLog;
    }

    if (!immediate) return emailLog;

    return this.attemptDelivery(emailLog);
  }

  /**
   * Try to deliver one queued message and record the result.
   * Exported for the retry worker to call on due rows.
   */
  async attemptDelivery(emailLog: EmailLog): Promise<EmailLog> {
    const provider = getEmailProvider();
    const attempt = emailLog.attempts + 1;

    await prisma.emailLog.update({
      where: { id: emailLog.id },
      data: { status: EmailStatus.SENDING, attempts: attempt },
    });

    // Attachments are regenerated per attempt rather than stored. A receipt
    // PDF per email row would bloat the table, and regenerating costs less
    // than keeping stale copies that could disagree with the invoice.
    const attachments = await this.buildAttachments(emailLog);

    const result = await provider.send({
      to: emailLog.toEmail,
      subject: emailLog.subject,
      html: emailLog.body,
      text: textFromLog(emailLog),
      templateKey: emailLog.templateKey,
      attachments,
    });

    if (result.success) {
      return prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: EmailStatus.SENT,
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
    // change; park it immediately so the owner sees it in the failed queue.
    const exhausted = attempt >= emailLog.maxAttempts;
    const permanent = result.retryable === false;
    const dead = exhausted || permanent;

    if (dead) {
      log.error(
        {
          emailLogId: emailLog.id,
          code: result.errorCode,
          attempts: attempt,
          permanent,
        },
        'Email failed permanently',
      );
    }

    return prisma.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: dead ? EmailStatus.DEAD : EmailStatus.FAILED,
        failedAt: new Date(),
        errorCode: result.errorCode ?? null,
        errorMessage: result.errorMessage ?? null,
        rawResponse: (result.rawResponse ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        // Exponential backoff: a throttled mail server needs longer each
        // time, and hammering it makes the throttle worse.
        nextRetryAt: dead
          ? null
          : new Date(
              Date.now() + emailConfig.retryBackoffMs * Math.pow(2, attempt - 1),
            ),
      },
    });
  }

  private async buildAttachments(
    emailLog: EmailLog,
  ): Promise<EmailAttachment[] | undefined> {
    const meta = emailLog.attachments as { invoiceId?: string } | null;
    if (!meta?.invoiceId) return undefined;

    try {
      const { buffer, filename } = await generateReceiptPdf(meta.invoiceId);
      return [{ filename, content: buffer, contentType: 'application/pdf' }];
    } catch (error) {
      // A missing receipt must not stop the welcome email. The member still
      // needs their ID and dates; the receipt can be re-sent from the desk.
      log.error(
        { err: error, emailLogId: emailLog.id, invoiceId: meta.invoiceId },
        'Receipt PDF failed to generate; sending email without it',
      );
      return undefined;
    }
  }

  /** Manually retry a failed email from the Messages UI. */
  async retryMessage(emailLogId: string): Promise<EmailLog> {
    const emailLog = await prisma.emailLog.findUniqueOrThrow({
      where: { id: emailLogId },
    });

    // Give it a fresh budget; the operator has presumably fixed the cause
    // (a corrected address, a rotated SMTP password, and so on).
    const reset = await prisma.emailLog.update({
      where: { id: emailLogId },
      data: {
        status: EmailStatus.QUEUED,
        attempts: 0,
        maxAttempts: Math.max(emailLog.maxAttempts, env.EMAIL_MAX_RETRIES),
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
        failedAt: null,
      },
    });

    return this.attemptDelivery(reset);
  }

  /** Rows due for another attempt, oldest first. */
  async getRetryable(limit = 25): Promise<EmailLog[]> {
    return prisma.emailLog.findMany({
      where: {
        status: EmailStatus.FAILED,
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
      if (updated.status === EmailStatus.SENT) sent++;
    }

    return { attempted: due.length, sent };
  }
}

/**
 * Recover the plain-text part.
 *
 * Only the HTML body is persisted — storing both doubles the row for content
 * derived from the same variables. Re-rendering from the template keeps the
 * two in step; if the template has since changed, the text follows the
 * current wording, which is what a resend should say anyway.
 */
function textFromLog(emailLog: EmailLog): string {
  const template = EMAIL_TEMPLATES[emailLog.templateKey];
  const variables = (emailLog.variables ?? {}) as Record<
    string,
    string | number
  >;
  return renderEmailTemplate(template.text, variables, false);
}

function providerNameToEnum(name: string) {
  switch (name) {
    case 'smtp':
      return 'SMTP' as const;
    case 'brevo':
      return 'BREVO' as const;
    case 'resend':
      return 'RESEND' as const;
    default:
      return 'MOCK' as const;
  }
}

export const emailService = new EmailService();
