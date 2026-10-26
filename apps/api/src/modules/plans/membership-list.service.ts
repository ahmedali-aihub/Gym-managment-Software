import {
  normalizePhone,
  type MembershipActivity,
  type MembershipKind,
  type MembershipListItem,
  type MembershipQuery,
  type PaginatedResponse,
} from '@azf/shared';
import type { Prisma } from '@prisma/client';
import { buildPaginatedResponse, getSkipTake } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';

/**
 * The Memberships page: every membership, newest first — sign-ups,
 * renewals, upgrades — with who it was for, the plan and period, what was
 * paid against it and who entered it.
 *
 * Read-only, and kept apart from MembershipsService on purpose: nothing here
 * changes a membership, so nothing the desk already relies on can be
 * affected by it.
 */

/** The events that say how a membership came about. */
const ORIGIN_EVENTS = ['CREATED', 'RENEWED', 'UPGRADED', 'TRANSFERRED_IN'] as const;

const KIND_BY_EVENT: Record<(typeof ORIGIN_EVENTS)[number], MembershipKind> = {
  CREATED: 'NEW',
  RENEWED: 'RENEWAL',
  UPGRADED: 'UPGRADE',
  TRANSFERRED_IN: 'TRANSFER',
};

/** Midnight at the start of today, this week (Monday) or this month. */
function periodStart(since: 'today' | 'week' | 'month'): Date {
  // The server runs on IST (config/timezone.ts), so local midnight is the
  // gym's midnight.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (since === 'week') {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (since === 'month') {
    start.setDate(1);
  }
  return start;
}

const LIST_SELECT = {
  id: true,
  createdAt: true,
  startDate: true,
  endDate: true,
  status: true,
  totalPaise: true,
  plan: { select: { id: true, name: true, durationDays: true } },
  member: {
    select: {
      id: true,
      memberId: true,
      fullName: true,
      phone: true,
      gender: true,
      photoUrl: true,
    },
  },
  payments: {
    where: { deletedAt: null },
    select: { amountPaise: true, refundedPaise: true },
  },
  events: {
    where: { type: { in: [...ORIGIN_EVENTS] } },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { type: true, performedBy: { select: { fullName: true } } },
  },
} satisfies Prisma.MembershipSelect;

type ListRow = Prisma.MembershipGetPayload<{ select: typeof LIST_SELECT }>;

function toItem(row: ListRow): MembershipListItem {
  const origin = row.events[0];
  const paidPaise = row.payments.reduce(
    (sum, payment) => sum + payment.amountPaise - payment.refundedPaise,
    0,
  );

  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    status: row.status,
    // Imported history has no events: it came from the old software, and
    // whether it was a sign-up or a renewal there is not known.
    kind: origin
      ? KIND_BY_EVENT[origin.type as keyof typeof KIND_BY_EVENT]
      : 'IMPORTED',
    plan: row.plan,
    member: row.member,
    totalPaise: row.totalPaise,
    paidPaise,
    balancePaise: Math.max(0, row.totalPaise - paidPaise),
    addedBy: origin?.performedBy?.fullName ?? null,
  };
}

class MembershipListService {
  async list(params: MembershipQuery): Promise<PaginatedResponse<MembershipListItem>> {
    const where: Prisma.MembershipWhereInput = {
      member: { deletedAt: null },
    };

    if (params.status) where.status = params.status;
    if (params.since !== 'all') {
      where.createdAt = { gte: periodStart(params.since) };
    }
    if (params.kind) {
      where.events = {
        some: { type: params.kind === 'NEW' ? 'CREATED' : 'RENEWED' },
      };
    }

    if (params.search) {
      // Same rules as the member list: name or member ID, or any part of the
      // phone number however it was typed.
      const term = params.search.trim();
      const digits = term.replace(/\D/g, '');
      const memberMatch: Prisma.MemberWhereInput[] = [
        { fullName: { contains: term, mode: 'insensitive' } },
        { memberId: { contains: term, mode: 'insensitive' } },
      ];
      if (digits.length >= 4) {
        memberMatch.push({ phone: { contains: normalizePhone(digits) } });
        if (normalizePhone(digits) !== digits) {
          memberMatch.push({ phone: { contains: digits } });
        }
      }
      where.member = { deletedAt: null, OR: memberMatch };
    }

    const { skip, take } = getSkipTake(params);
    const [rows, total] = await Promise.all([
      prisma.membership.findMany({
        where,
        select: LIST_SELECT,
        // Newest first; the id breaks ties so paging never repeats a row.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      prisma.membership.count({ where }),
    ]);

    return buildPaginatedResponse(rows.map(toItem), total, params);
  }

  /** Memberships added today, this week and this month, split by kind. */
  async activity(): Promise<MembershipActivity> {
    const monthStart = periodStart('month');
    const weekStart = periodStart('week');
    const todayStart = periodStart('today');
    // The week can begin in the previous month.
    const from = weekStart < monthStart ? weekStart : monthStart;

    const rows = await prisma.membership.findMany({
      where: { createdAt: { gte: from }, member: { deletedAt: null } },
      select: {
        createdAt: true,
        events: {
          where: { type: { in: ['CREATED', 'RENEWED'] } },
          take: 1,
          select: { type: true },
        },
      },
    });

    const tally = (start: Date) => {
      const inPeriod = rows.filter((row) => row.createdAt >= start);
      return {
        total: inPeriod.length,
        new: inPeriod.filter((row) => row.events[0]?.type === 'CREATED').length,
        renewals: inPeriod.filter((row) => row.events[0]?.type === 'RENEWED')
          .length,
      };
    };

    return {
      today: tally(todayStart),
      week: tally(weekStart),
      month: tally(monthStart),
    };
  }
}

export const membershipListService = new MembershipListService();
