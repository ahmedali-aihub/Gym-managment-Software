import type { PaginatedResponse } from '@azf/shared';
import type { Lead, LeadSource, LeadStatus, Prisma } from '@prisma/client';
import { InvalidStateError, NotFoundError } from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import {
  buildPaginatedResponse,
  getSkipTake,
} from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';

const log = moduleLogger('leads');

export interface LeadQueryParams {
  page: number;
  limit: number;
  search?: string | undefined;
  status?: LeadStatus | undefined;
  source?: LeadSource | undefined;
  /** Only leads whose follow-up is due today or overdue. */
  dueOnly?: boolean | undefined;
}

export interface CreateLeadInput {
  fullName: string;
  phone: string;
  email?: string | undefined;
  source: LeadSource;
  interestedIn?: string | undefined;
  quotedPlanId?: string | undefined;
  notes?: string | undefined;
  followUpAt?: Date | undefined;
  assignedToId?: string | undefined;
}

/**
 * Lead pipeline.
 *
 * A gym's growth problem is rarely "nobody enquires" — it is that enquiries
 * are forgotten. So the model is built around ONE question: who needs calling
 * today? Status alone cannot answer it, which is why every contact attempt is
 * logged as an activity.
 */
class LeadsService {
  async list(params: LeadQueryParams): Promise<PaginatedResponse<unknown>> {
    const { skip, take } = getSkipTake(params);

    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...(params.status ? { status: params.status } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.dueOnly
        ? {
            followUpAt: { lte: endOfToday() },
            // A converted or lost lead is finished; chasing it is noise.
            status: { notIn: ['CONVERTED', 'LOST'] },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { fullName: { contains: params.search, mode: 'insensitive' } },
              { phone: { contains: params.search.replace(/\D/g, '') } },
              { email: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take,
        // Overdue follow-ups first; a null follow-up date sorts last.
        orderBy: [{ followUpAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          quotedPlan: { select: { id: true, name: true, pricePaise: true } },
          assignedTo: { select: { id: true, fullName: true } },
          activities: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { type: true, summary: true, createdAt: true },
          },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, params);
  }

  async create(
    input: CreateLeadInput,
    actorId: string | null,
  ): Promise<Lead> {
    const lead = await prisma.lead.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email ?? null,
        source: input.source,
        interestedIn: input.interestedIn ?? null,
        quotedPlanId: input.quotedPlanId ?? null,
        notes: input.notes ?? null,
        // Default to tomorrow: an enquiry with no follow-up date is an
        // enquiry nobody will ever call back.
        followUpAt: input.followUpAt ?? tomorrow(),
        assignedToId: input.assignedToId ?? actorId,
        activities: {
          create: {
            type: 'NOTE',
            summary: `Enquiry received via ${input.source.toLowerCase().replace('_', ' ')}`,
            performedById: actorId,
          },
        },
      },
    });

    log.info({ leadId: lead.id, source: lead.source }, 'Lead created');
    return lead;
  }

  async getById(id: string) {
    const lead = await prisma.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        quotedPlan: { select: { id: true, name: true, pricePaise: true } },
        assignedTo: { select: { id: true, fullName: true } },
        activities: {
          orderBy: { createdAt: 'desc' },
          include: { performedBy: { select: { id: true, fullName: true } } },
        },
      },
    });

    if (!lead) throw new NotFoundError('Lead');
    return lead;
  }

  /**
   * Move a lead through the pipeline.
   *
   * The status change is logged as an activity too, so the history reads as
   * a narrative rather than a single mutable field.
   */
  async updateStatus(
    id: string,
    status: LeadStatus,
    options: {
      note?: string | undefined;
      followUpAt?: Date | undefined;
      lostReason?: string | undefined;
      actorId: string | null;
    },
  ): Promise<Lead> {
    const lead = await prisma.lead.findFirst({
      where: { id, deletedAt: null },
    });
    if (!lead) throw new NotFoundError('Lead');

    if (lead.status === 'CONVERTED') {
      throw new InvalidStateError(
        'This lead has already converted to a member',
      );
    }

    if (status === 'LOST' && !options.lostReason?.trim()) {
      throw new InvalidStateError(
        'A reason is required when marking a lead as lost',
      );
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: {
        status,
        // A finished lead should stop appearing in the due list.
        followUpAt:
          status === 'CONVERTED' || status === 'LOST'
            ? null
            : (options.followUpAt ?? lead.followUpAt),
        lostReason: status === 'LOST' ? options.lostReason : null,
        activities: {
          create: {
            type: 'STATUS_CHANGE',
            summary:
              options.note?.trim() ||
              `Moved from ${lead.status.replace('_', ' ').toLowerCase()} to ${status.replace('_', ' ').toLowerCase()}`,
            performedById: options.actorId,
          },
        },
      },
    });

    log.info({ leadId: id, from: lead.status, to: status }, 'Lead status changed');
    return updated;
  }

  /** Record a call, visit or note against a lead. */
  async addActivity(
    leadId: string,
    input: { type: string; summary: string; followUpAt?: Date | undefined },
    actorId: string | null,
  ) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null },
    });
    if (!lead) throw new NotFoundError('Lead');

    const [activity] = await prisma.$transaction([
      prisma.leadActivity.create({
        data: {
          leadId,
          type: input.type,
          summary: input.summary,
          performedById: actorId,
        },
      }),
      prisma.lead.update({
        where: { id: leadId },
        data: {
          // Logging contact without setting the next one is how leads go
          // quiet, so the caller is expected to supply it.
          ...(input.followUpAt ? { followUpAt: input.followUpAt } : {}),
          // First contact moves a NEW lead along automatically.
          ...(lead.status === 'NEW' ? { status: 'CONTACTED' as LeadStatus } : {}),
        },
      }),
    ]);

    return activity;
  }

  /**
   * Convert a lead once the member exists.
   *
   * Called after registration, linking the two so conversion rate and source
   * effectiveness become measurable.
   */
  async markConverted(
    leadId: string,
    memberId: string,
    actorId: string | null,
  ): Promise<Lead> {
    return prisma.lead.update({
      where: { id: leadId },
      data: {
        status: 'CONVERTED',
        convertedMemberId: memberId,
        convertedAt: new Date(),
        followUpAt: null,
        activities: {
          create: {
            type: 'STATUS_CHANGE',
            summary: 'Converted to member',
            performedById: actorId,
          },
        },
      },
    });
  }

  async remove(id: string): Promise<void> {
    await prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Pipeline counts and conversion stats for the leads dashboard. */
  async getStats() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [byStatus, bySource, dueToday, overdue, recentConverted, recentTotal] =
      await Promise.all([
        prisma.lead.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        prisma.lead.groupBy({
          by: ['source'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        prisma.lead.count({
          where: {
            deletedAt: null,
            status: { notIn: ['CONVERTED', 'LOST'] },
            followUpAt: { gte: startOfToday(), lte: endOfToday() },
          },
        }),
        prisma.lead.count({
          where: {
            deletedAt: null,
            status: { notIn: ['CONVERTED', 'LOST'] },
            followUpAt: { lt: startOfToday() },
          },
        }),
        prisma.lead.count({
          where: {
            deletedAt: null,
            status: 'CONVERTED',
            convertedAt: { gte: thirtyDaysAgo },
          },
        }),
        prisma.lead.count({
          where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } },
        }),
      ]);

    const counts = new Map(byStatus.map((row) => [row.status, row._count._all]));
    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);

    return {
      total,
      byStatus: Object.fromEntries(counts),
      bySource: bySource
        .map((row) => ({ source: row.source, count: row._count._all }))
        .sort((a, b) => b.count - a.count),
      dueToday,
      overdue,
      // Over the last 30 days, so the figure reflects current performance
      // rather than being diluted by a slow month two years ago.
      conversionRatePercent:
        recentTotal > 0
          ? Number(((recentConverted / recentTotal) * 100).toFixed(1))
          : null,
    };
  }
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday(): Date {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function tomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  return date;
}

export const leadsService = new LeadsService();
