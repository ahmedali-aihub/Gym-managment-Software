import {
  EMAIL_TEMPLATE_LABELS,
  MessageStatus,
  WHATSAPP_TEMPLATE_LABELS,
  type MessageChannel,
  type MessageLogQuery,
  type MessageLogRow,
  type MessageStats,
} from '@azf/shared';
import type { EmailLog, Prisma, WhatsAppLog } from '@prisma/client';
import type { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { emailService } from '../../services/email/email.service.js';
import { getEmailProvider } from '../../services/email/providers/index.js';
import { getWhatsAppProvider } from '../../services/whatsapp/providers/index.js';
import { whatsappService } from '../../services/whatsapp/whatsapp.service.js';

type MemberRef = { id: string; memberId: string; fullName: string } | null;

/**
 * Normalize a status from either channel into the shared vocabulary.
 * WhatsApp's READ collapses into DELIVERED — see the schema's own note.
 */
function toMessageStatus(status: string): MessageStatus {
  if (status === 'READ') return MessageStatus.DELIVERED;
  return status as MessageStatus;
}

function fromEmailLog(row: EmailLog & { member: MemberRef }): MessageLogRow {
  return {
    id: row.id,
    channel: 'EMAIL',
    to: row.toEmail,
    templateKey: row.templateKey,
    templateLabel: EMAIL_TEMPLATE_LABELS[row.templateKey],
    preview: row.subject,
    status: toMessageStatus(row.status),
    nativeStatus: row.status,
    provider: row.provider,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    member: row.member,
  };
}

function fromWhatsAppLog(
  row: WhatsAppLog & { member: MemberRef },
): MessageLogRow {
  return {
    id: row.id,
    channel: 'WHATSAPP',
    to: row.toPhone,
    templateKey: row.templateKey,
    templateLabel: WHATSAPP_TEMPLATE_LABELS[row.templateKey],
    // WhatsApp has no subject line, so the rendered body stands in, trimmed
    // to read at a glance the way a subject line does.
    preview:
      row.body.length > 120 ? `${row.body.slice(0, 117)}...` : row.body,
    status: toMessageStatus(row.status),
    nativeStatus: row.status,
    provider: row.provider,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    member: row.member,
  };
}

const MEMBER_SELECT = {
  select: { id: true, memberId: true, fullName: true },
} as const;

/**
 * Shared filter fragment for whichever table is being queried. Only the
 * status enum differs by channel (WhatsApp adds READ as a value email does
 * not have) so status filtering is applied per query below instead.
 */
function commonWhere(params: MessageLogQuery): {
  memberId?: string;
  createdAt?: { gte?: Date; lte?: Date };
} {
  return {
    ...(params.memberId ? { memberId: params.memberId } : {}),
    ...(params.from || params.to
      ? {
          createdAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lte: params.to } : {}),
          },
        }
      : {}),
  };
}

/**
 * Translate a shared MessageStatus into the channel-specific statuses that
 * mean the same thing. DELIVERED on the shared vocabulary matches both
 * DELIVERED and READ on WhatsApp, since the list collapses them; email has
 * no delivery callback from SMTP and so no DELIVERED state — filtering for
 * it there returns an empty (not unfiltered) result.
 */
function statusFilterFor(
  channel: 'email' | 'whatsapp',
  status: MessageStatus | undefined,
): string[] | undefined {
  if (!status) return undefined;
  if (status === MessageStatus.DELIVERED) {
    return channel === 'whatsapp' ? ['DELIVERED', 'READ'] : [];
  }
  return [status];
}

async function memberRef(memberId: string | null): Promise<MemberRef> {
  if (!memberId) return null;
  return prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true, memberId: true, fullName: true },
  });
}

export const messagesController = {
  /**
   * The unified log: email and WhatsApp rows merged by createdAt.
   *
   * Each underlying table is paginated independently up to a full page's
   * worth, then merged and re-sliced. That over-fetches slightly when both
   * channels are busy on the same page boundary, which is the safe side to
   * err on — under-fetching would silently drop a channel's messages off a
   * page whenever the other channel dominates that time window.
   */
  async logs(req: Request, res: Response): Promise<void> {
    const params = req.query as unknown as MessageLogQuery;
    const { page, limit, channel } = params;
    const base = commonWhere(params);

    const wantsEmail = channel === 'all' || channel === 'email';
    const wantsWhatsApp = channel === 'all' || channel === 'whatsapp';

    const emailStatuses = statusFilterFor('email', params.status);
    const whatsappStatuses = statusFilterFor('whatsapp', params.status);

    const emailWhere: Prisma.EmailLogWhereInput | null =
      wantsEmail && (!params.status || (emailStatuses?.length ?? 0) > 0)
        ? {
            ...base,
            ...(emailStatuses
              ? { status: { in: emailStatuses as never[] } }
              : {}),
            ...(params.search
              ? {
                  OR: [
                    {
                      toEmail: {
                        contains: params.search,
                        mode: 'insensitive',
                      },
                    },
                    {
                      subject: {
                        contains: params.search,
                        mode: 'insensitive',
                      },
                    },
                  ],
                }
              : {}),
          }
        : null;

    const whatsappWhere: Prisma.WhatsAppLogWhereInput | null =
      wantsWhatsApp && (!params.status || (whatsappStatuses?.length ?? 0) > 0)
        ? {
            ...base,
            ...(whatsappStatuses
              ? { status: { in: whatsappStatuses as never[] } }
              : {}),
            ...(params.search
              ? {
                  OR: [
                    {
                      toPhone: {
                        contains: params.search.replace(/\D/g, ''),
                      },
                    },
                    { body: { contains: params.search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          }
        : null;

    // Enough from each channel that merging two sorted lists and re-slicing
    // to `limit` cannot come up short on any page.
    const fetchLimit = page * limit;

    const [emailRows, emailTotal, whatsappRows, whatsappTotal] =
      await Promise.all([
        emailWhere
          ? prisma.emailLog.findMany({
              where: emailWhere,
              orderBy: { createdAt: 'desc' },
              take: fetchLimit,
              include: { member: MEMBER_SELECT },
            })
          : Promise.resolve([]),
        emailWhere
          ? prisma.emailLog.count({ where: emailWhere })
          : Promise.resolve(0),
        whatsappWhere
          ? prisma.whatsAppLog.findMany({
              where: whatsappWhere,
              orderBy: { createdAt: 'desc' },
              take: fetchLimit,
              include: { member: MEMBER_SELECT },
            })
          : Promise.resolve([]),
        whatsappWhere
          ? prisma.whatsAppLog.count({ where: whatsappWhere })
          : Promise.resolve(0),
      ]);

    const merged: MessageLogRow[] = [
      ...emailRows.map(fromEmailLog),
      ...whatsappRows.map(fromWhatsAppLog),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = emailTotal + whatsappTotal;
    const skip = (page - 1) * limit;
    const data = merged.slice(skip, skip + limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  },

  /** The failed queue — both channels, needs-attention only. */
  async failedQueue(req: Request, res: Response): Promise<void> {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const fetchLimit = page * limit;

    const failedFilter = { status: { in: ['FAILED', 'DEAD'] as ('FAILED' | 'DEAD')[] } };

    const [emailRows, emailTotal, whatsappRows, whatsappTotal] =
      await Promise.all([
        prisma.emailLog.findMany({
          where: failedFilter,
          orderBy: { failedAt: 'desc' },
          take: fetchLimit,
          include: { member: MEMBER_SELECT },
        }),
        prisma.emailLog.count({ where: failedFilter }),
        prisma.whatsAppLog.findMany({
          where: failedFilter,
          orderBy: { failedAt: 'desc' },
          take: fetchLimit,
          include: { member: MEMBER_SELECT },
        }),
        prisma.whatsAppLog.count({ where: failedFilter }),
      ]);

    const merged: MessageLogRow[] = [
      ...emailRows.map(fromEmailLog),
      ...whatsappRows.map(fromWhatsAppLog),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = emailTotal + whatsappTotal;
    const skip = (page - 1) * limit;
    const data = merged.slice(skip, skip + limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  },

  async stats(_req: Request, res: Response): Promise<void> {
    const [emailByStatus, whatsappByStatus] = await Promise.all([
      prisma.emailLog.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.whatsAppLog.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const emailCounts = new Map(
      emailByStatus.map((s) => [s.status, s._count._all]),
    );
    const whatsappCounts = new Map(
      whatsappByStatus.map((s) => [s.status, s._count._all]),
    );

    const emailTotal = emailByStatus.reduce(
      (sum, s) => sum + s._count._all,
      0,
    );
    const whatsappTotal = whatsappByStatus.reduce(
      (sum, s) => sum + s._count._all,
      0,
    );

    const delivered =
      (whatsappCounts.get('DELIVERED') ?? 0) +
      (whatsappCounts.get('READ') ?? 0);
    // Email has no delivery callback from SMTP, so SENT is its ceiling —
    // counted toward the delivery rate the same way the SMS page treats it.
    const sent =
      (emailCounts.get('SENT') ?? 0) + (whatsappCounts.get('SENT') ?? 0);
    const total = emailTotal + whatsappTotal;
    const failed =
      (emailCounts.get('FAILED') ?? 0) + (whatsappCounts.get('FAILED') ?? 0);
    const dead =
      (emailCounts.get('DEAD') ?? 0) + (whatsappCounts.get('DEAD') ?? 0);
    const queued =
      (emailCounts.get('QUEUED') ?? 0) + (whatsappCounts.get('QUEUED') ?? 0);

    const stats: MessageStats = {
      total,
      emailTotal,
      whatsappTotal,
      queued,
      sent,
      delivered,
      failed,
      dead,
      deliveryRate: total > 0 ? ((delivered + sent) / total) * 100 : 0,
    };

    res.json({ success: true, data: stats });
  },

  async retry(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;
    const channel = req.params.channel as MessageChannel | undefined;

    if (channel === 'EMAIL') {
      const existing = await prisma.emailLog.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('Email');
      const result = await emailService.retryMessage(id);
      const member = await memberRef(existing.memberId);
      res.json({ success: true, data: fromEmailLog({ ...result, member }) });
      return;
    }

    if (channel === 'WHATSAPP') {
      const existing = await prisma.whatsAppLog.findUnique({ where: { id } });
      if (!existing) throw new NotFoundError('WhatsApp message');
      const result = await whatsappService.retryMessage(id);
      const member = await memberRef(existing.memberId);
      res.json({
        success: true,
        data: fromWhatsAppLog({ ...result, member }),
      });
      return;
    }

    throw new ValidationError('Unknown channel', {
      channel: ['Must be EMAIL or WHATSAPP'],
    });
  },

  /** Drain the whole failed queue across both channels — the "retry all" button. */
  async retryAll(_req: Request, res: Response): Promise<void> {
    const failedFilter = { status: { in: ['FAILED', 'DEAD'] as ('FAILED' | 'DEAD')[] } };

    const [failedEmails, failedWhatsapp] = await Promise.all([
      prisma.emailLog.findMany({
        where: failedFilter,
        select: { id: true },
        take: 200,
      }),
      prisma.whatsAppLog.findMany({
        where: failedFilter,
        select: { id: true },
        take: 200,
      }),
    ]);

    let succeeded = 0;
    for (const { id } of failedEmails) {
      const result = await emailService.retryMessage(id);
      if (result.status === 'SENT') succeeded++;
    }
    for (const { id } of failedWhatsapp) {
      const result = await whatsappService.retryMessage(id);
      if (result.status === 'SENT' || result.status === 'DELIVERED') {
        succeeded++;
      }
    }

    const attempted = failedEmails.length + failedWhatsapp.length;

    res.json({
      success: true,
      data: {
        attempted,
        succeeded,
        failed: attempted - succeeded,
      },
    });
  },

  /** Which providers are active and whether they are correctly configured. */
  async providerStatus(_req: Request, res: Response): Promise<void> {
    const [email, whatsapp] = await Promise.all([
      getEmailProvider().verifyConfiguration(),
      getWhatsAppProvider().verifyConfiguration(),
    ]);

    res.json({
      success: true,
      data: {
        email: { provider: getEmailProvider().name, ...email },
        whatsapp: { provider: getWhatsAppProvider().name, ...whatsapp },
      },
    });
  },
};
