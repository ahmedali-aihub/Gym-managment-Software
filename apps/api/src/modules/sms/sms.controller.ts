import type { SendBulkSmsInput, SendSmsInput, SmsLogQuery } from '@azf/shared';
import {
  SMS_TEMPLATES,
  SmsStatus,
  formatDate,
  type SmsStats,
} from '@azf/shared';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { gymConfig } from '../../config/env.js';
import { NotFoundError } from '../../lib/errors.js';
import {
  buildPaginatedResponse,
  getSkipTake,
} from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { requireUser } from '../../middleware/auth.middleware.js';
import { getSmsProvider } from '../../services/sms/providers/index.js';
import { smsService } from '../../services/sms/sms.service.js';

export const smsController = {
  /** Template catalogue for the compose UI. */
  async templates(_req: Request, res: Response): Promise<void> {
    res.json({ success: true, data: Object.values(SMS_TEMPLATES) });
  },

  async send(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const input = req.body as SendSmsInput;

    const log = await smsService.send({
      to: input.to,
      templateKey: input.templateKey,
      variables: input.variables,
      memberId: input.memberId,
      sentById: actor.sub,
      immediate: input.immediate,
    });

    res.status(201).json({ success: true, data: log });
  },

  /**
   * Send one template to many members — the "remind everyone expiring" action.
   *
   * Messages are QUEUED rather than sent inline: 200 sequential gateway calls
   * would hold the HTTP request open for minutes and time out. The retry
   * worker drains the queue in the background.
   *
   * Per-member variables are resolved HERE, not supplied by the caller. An
   * expiry reminder needs each member's own expiry date and a dues reminder
   * each member's own balance — one shared value would produce messages that
   * are wrong for everyone but the first person, and an SMS quoting the wrong
   * date is worse than no SMS at all.
   */
  async sendBulk(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const input = req.body as SendBulkSmsInput;

    const members = await prisma.member.findMany({
      where: { id: { in: input.memberIds }, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        phone: true,
        memberId: true,
        memberships: {
          where: { status: { in: ['ACTIVE', 'FROZEN'] } },
          orderBy: { endDate: 'desc' },
          take: 1,
          select: { endDate: true, totalPaise: true },
        },
      },
    });

    // Balances, in two grouped queries rather than one per member.
    const ids = members.map((m) => m.id);
    const [billed, paid] = await Promise.all([
      prisma.membership.groupBy({
        by: ['memberId'],
        where: { memberId: { in: ids } },
        _sum: { totalPaise: true },
      }),
      prisma.payment.groupBy({
        by: ['memberId'],
        where: { memberId: { in: ids }, deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
    ]);

    const billedBy = new Map(
      billed.map((row) => [row.memberId, row._sum.totalPaise ?? 0]),
    );
    const paidBy = new Map(
      paid.map((row) => [
        row.memberId,
        (row._sum.amountPaise ?? 0) - (row._sum.refundedPaise ?? 0),
      ]),
    );

    const queued = await Promise.all(
      members.map((member) => {
        const expiry = member.memberships[0]?.endDate ?? null;
        const balancePaise = Math.max(
          0,
          (billedBy.get(member.id) ?? 0) - (paidBy.get(member.id) ?? 0),
        );

        return smsService.send({
          to: member.phone,
          templateKey: input.templateKey,
          memberId: member.id,
          sentById: actor.sub,
          immediate: false,
          variables: {
            // Caller-supplied values first, so per-member facts below always
            // win over anything generic passed in.
            ...input.variables,
            name: member.fullName.split(' ')[0] ?? member.fullName,
            memberId: member.memberId,
            expiryDate: expiry ? formatDate(expiry) : '-',
            amount: Math.round(balancePaise / 100).toLocaleString('en-IN'),
            gymPhone: gymConfig.phone,
          },
        });
      }),
    );

    // Kick the queue without blocking the response.
    void smsService.processRetryQueue(queued.length);

    res.status(202).json({
      success: true,
      data: {
        queued: queued.length,
        skipped: input.memberIds.length - members.length,
        message: `${queued.length} messages queued for delivery`,
      },
    });
  },

  async logs(req: Request, res: Response): Promise<void> {
    const params = req.query as unknown as SmsLogQuery;
    const { skip, take } = getSkipTake(params);

    const where: Prisma.SmsLogWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.templateKey ? { templateKey: params.templateKey } : {}),
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.memberId ? { memberId: params.memberId } : {}),
      ...(params.from || params.to
        ? {
            createdAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { toPhone: { contains: params.search.replace(/\D/g, '') } },
              { body: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.smsLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          member: {
            select: { id: true, memberId: true, fullName: true },
          },
        },
      }),
      prisma.smsLog.count({ where }),
    ]);

    res.json({ success: true, ...buildPaginatedResponse(data, total, params) });
  },

  /** The failed-SMS queue surfaced in the UI. */
  async failedQueue(req: Request, res: Response): Promise<void> {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { skip, take } = getSkipTake({ page, limit });

    const where: Prisma.SmsLogWhereInput = {
      status: { in: [SmsStatus.FAILED, SmsStatus.DEAD] },
    };

    const [data, total] = await Promise.all([
      prisma.smsLog.findMany({
        where,
        skip,
        take,
        orderBy: { failedAt: 'desc' },
        include: {
          member: {
            select: { id: true, memberId: true, fullName: true, phone: true },
          },
        },
      }),
      prisma.smsLog.count({ where }),
    ]);

    res.json({
      success: true,
      ...buildPaginatedResponse(data, total, { page, limit }),
    });
  },

  async retry(req: Request, res: Response): Promise<void> {
    const id = req.params.id as string;

    const existing = await prisma.smsLog.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('SMS log');

    const result = await smsService.retryMessage(id);
    res.json({ success: true, data: result });
  },

  /** Drain the whole failed queue — the "retry all" button. */
  async retryAll(_req: Request, res: Response): Promise<void> {
    const failed = await prisma.smsLog.findMany({
      where: { status: { in: [SmsStatus.FAILED, SmsStatus.DEAD] } },
      select: { id: true },
      take: 200,
    });

    let succeeded = 0;
    for (const { id } of failed) {
      const result = await smsService.retryMessage(id);
      if (
        result.status === SmsStatus.SENT ||
        result.status === SmsStatus.DELIVERED
      ) {
        succeeded++;
      }
    }

    res.json({
      success: true,
      data: {
        attempted: failed.length,
        succeeded,
        failed: failed.length - succeeded,
      },
    });
  },

  async stats(_req: Request, res: Response): Promise<void> {
    const [byStatus, segments] = await Promise.all([
      prisma.smsLog.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.smsLog.aggregate({ _sum: { segments: true } }),
    ]);

    const counts = new Map(byStatus.map((s) => [s.status, s._count._all]));
    const total = byStatus.reduce((sum, s) => sum + s._count._all, 0);
    const delivered = counts.get(SmsStatus.DELIVERED) ?? 0;
    const sent = counts.get(SmsStatus.SENT) ?? 0;

    const stats: SmsStats = {
      total,
      queued: counts.get(SmsStatus.QUEUED) ?? 0,
      sent,
      delivered,
      failed: counts.get(SmsStatus.FAILED) ?? 0,
      dead: counts.get(SmsStatus.DEAD) ?? 0,
      // Sent-but-unconfirmed counts as delivered here; providers that offer no
      // status callback would otherwise show a permanently poor delivery rate.
      deliveryRate: total > 0 ? ((delivered + sent) / total) * 100 : 0,
      segmentsUsed: segments._sum.segments ?? 0,
    };

    res.json({ success: true, data: stats });
  },

  /** Which provider is active and whether it is correctly configured. */
  async providerStatus(_req: Request, res: Response): Promise<void> {
    const provider = getSmsProvider();
    const config = await provider.verifyConfiguration();

    res.json({
      success: true,
      data: { provider: provider.name, ...config },
    });
  },
};
