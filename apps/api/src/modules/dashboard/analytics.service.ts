import { MembershipStatus, formatDate } from '@azf/shared';
import { prisma } from '../../lib/prisma.js';
import { calculateBalance } from '../payments/billing.js';

/**
 * Period analytics.
 *
 * The owner's real questions are "how did we do today?", "how does this month
 * compare to last?", and "is the business growing?". Each of those is the same
 * query over a different window, so the window is a parameter rather than
 * three near-identical endpoints.
 *
 * Every period returns its own figures AND the equivalent preceding period,
 * because a number without a comparison is not an insight. ₹45,000 collected
 * this month means nothing until you know last month was ₹38,000.
 */

export type PeriodKey =
  | 'today'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'all'
  | 'custom';

/** An explicit from/to, required when the key is 'custom'. */
export interface CustomRange {
  from: Date;
  to: Date;
}

export interface PeriodRange {
  from: Date;
  to: Date;
  /** The equivalent window immediately before, for comparison. */
  previousFrom: Date;
  previousTo: Date;
  label: string;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Resolve a period key into an absolute range plus its predecessor.
 *
 * Quarters follow the INDIAN FINANCIAL YEAR (Apr–Jun, Jul–Sep, Oct–Dec,
 * Jan–Mar), not the calendar year. An Indian gym owner comparing quarters is
 * thinking about the same quarters their accountant is.
 */
export function resolvePeriod(
  key: PeriodKey,
  now = new Date(),
  custom?: CustomRange,
): PeriodRange {
  switch (key) {
    case 'today': {
      const from = startOfDay(now);
      const to = endOfDay(now);
      const previous = new Date(from);
      previous.setDate(previous.getDate() - 1);

      return {
        from,
        to,
        previousFrom: startOfDay(previous),
        previousTo: endOfDay(previous),
        label: 'Today',
      };
    }

    case 'week': {
      // Weeks start Monday — the convention in India, and the one that keeps
      // a weekend together rather than splitting it.
      const from = startOfDay(now);
      from.setDate(from.getDate() - ((now.getDay() + 6) % 7));
      const to = endOfDay(now);

      const previousFrom = new Date(from);
      previousFrom.setDate(previousFrom.getDate() - 7);
      const previousTo = new Date(from);
      previousTo.setMilliseconds(-1);

      return { from, to, previousFrom, previousTo, label: 'This week' };
    }

    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = endOfDay(now);

      const previousFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousTo = new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
        999,
      );

      return { from, to, previousFrom, previousTo, label: 'This month' };
    }

    case 'quarter': {
      // Financial quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar.
      const month = now.getMonth();
      const fyQuarter = Math.floor(((month + 9) % 12) / 3);
      const startMonth = (fyQuarter * 3 + 3) % 12;
      const startYear =
        startMonth > month ? now.getFullYear() - 1 : now.getFullYear();

      const from = new Date(startYear, startMonth, 1);
      const to = endOfDay(now);

      const previousFrom = new Date(startYear, startMonth - 3, 1);
      const previousTo = new Date(startYear, startMonth, 0, 23, 59, 59, 999);

      return { from, to, previousFrom, previousTo, label: 'This quarter' };
    }

    case 'year': {
      // Indian financial year: 1 April – 31 March.
      const startYear =
        now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

      const from = new Date(startYear, 3, 1);
      const to = endOfDay(now);

      const previousFrom = new Date(startYear - 1, 3, 1);
      const previousTo = new Date(startYear, 2, 31, 23, 59, 59, 999);

      return { from, to, previousFrom, previousTo, label: 'This year' };
    }

    case 'custom': {
      if (!custom) {
        throw new Error("resolvePeriod('custom') requires a from/to range");
      }

      // Normalise to whole days and tolerate a reversed range rather than
      // returning zero results for what is obviously a typo.
      const [earlier, later] =
        custom.from <= custom.to
          ? [custom.from, custom.to]
          : [custom.to, custom.from];
      const from = startOfDay(earlier);
      const to = endOfDay(later);

      // The preceding window of the SAME LENGTH, ending the day before.
      // Matching the day count matters: a 15-day range compared against a
      // full previous month would show a fake collapse in revenue.
      //
      // Day arithmetic goes through setDate rather than adding 86.4e6 ms.
      // IST has no DST so both agree today, but a fixed-millisecond day is
      // wrong the moment this runs under any zone that does shift.
      const dayMs = 24 * 60 * 60 * 1000;
      const days =
        Math.round((startOfDay(later).getTime() - from.getTime()) / dayMs) + 1;

      const previousTo = new Date(from);
      previousTo.setDate(previousTo.getDate() - 1);

      const previousFrom = new Date(previousTo);
      previousFrom.setDate(previousFrom.getDate() - (days - 1));

      return {
        from,
        to,
        previousFrom: startOfDay(previousFrom),
        previousTo: endOfDay(previousTo),
        label:
          days === 1
            ? formatDate(from)
            : `${formatDate(from)} – ${formatDate(to)}`,
      };
    }

    case 'all':
    default: {
      const from = new Date(2000, 0, 1);
      const to = endOfDay(now);

      return {
        from,
        to,
        // No meaningful predecessor for all-time; an empty range yields zero,
        // and the UI renders "no prior data" rather than a bogus comparison.
        previousFrom: from,
        previousTo: from,
        label: 'All time',
      };
    }
  }
}

export interface PeriodAnalytics {
  period: {
    key: PeriodKey;
    label: string;
    from: string;
    to: string;
  };
  collected: { currentPaise: number; previousPaise: number; count: number };
  newMembers: { current: number; previous: number };
  renewals: { current: number; previous: number };
  expiring: { current: number };
  /** Outstanding dues are a running total, not period-scoped. */
  outstanding: { totalPaise: number; memberCount: number };
  /** Collections by payment mode, within the period. */
  byMode: Array<{ mode: string; amountPaise: number; count: number }>;
  /** Daily collections within the period, for the trend sparkline. */
  daily: Array<{ date: string; amountPaise: number }>;
}

/**
 * Parse a yyyy-MM-dd query parameter as a LOCAL date.
 *
 * `new Date('2026-09-01')` parses as UTC midnight, which in IST is
 * 05:30 on the 1st — so a range starting on the 1st would silently drop
 * everything collected before 05:30. Splitting the parts avoids that.
 */
export function parseDateParam(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  // Rejects 2026-02-31, which would otherwise roll into March.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null;
  }
  return date;
}

class AnalyticsService {
  async getPeriodAnalytics(
    key: PeriodKey,
    custom?: CustomRange,
  ): Promise<PeriodAnalytics> {
    const range = resolvePeriod(key, new Date(), custom);

    const [
      collectedCurrent,
      collectedPrevious,
      newCurrent,
      newPrevious,
      renewalsCurrent,
      renewalsPrevious,
      expiringCount,
      byMode,
      dailyRows,
      billedTotal,
      paidTotal,
      duesMembers,
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          deletedAt: null,
          paidAt: { gte: range.from, lte: range.to },
        },
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      prisma.payment.aggregate({
        where: {
          deletedAt: null,
          paidAt: { gte: range.previousFrom, lte: range.previousTo },
        },
        _sum: { amountPaise: true },
      }),
      prisma.member.count({
        where: { deletedAt: null, joinedAt: { gte: range.from, lte: range.to } },
      }),
      prisma.member.count({
        where: {
          deletedAt: null,
          joinedAt: { gte: range.previousFrom, lte: range.previousTo },
        },
      }),
      // A renewal is a membership created for a member who already had one,
      // which is what the RENEWED event records.
      prisma.membershipEvent.count({
        where: {
          type: 'RENEWED',
          createdAt: { gte: range.from, lte: range.to },
        },
      }),
      prisma.membershipEvent.count({
        where: {
          type: 'RENEWED',
          createdAt: { gte: range.previousFrom, lte: range.previousTo },
        },
      }),
      prisma.membership.count({
        where: {
          status: MembershipStatus.ACTIVE,
          endDate: { gte: new Date(), lte: range.to },
        },
      }),
      prisma.payment.groupBy({
        by: ['mode'],
        where: {
          deletedAt: null,
          paidAt: { gte: range.from, lte: range.to },
        },
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      prisma.payment.findMany({
        where: {
          deletedAt: null,
          paidAt: { gte: range.from, lte: range.to },
        },
        select: { paidAt: true, amountPaise: true },
      }),
      prisma.membership.aggregate({ _sum: { totalPaise: true } }),
      prisma.payment.aggregate({
        where: { deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
      this.countMembersWithDues(),
    ]);

    // Bucket payments by day for the trend line.
    const dayBuckets = new Map<string, number>();
    for (const payment of dailyRows) {
      const key = payment.paidAt.toISOString().slice(0, 10);
      dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + payment.amountPaise);
    }

    const daily = [...dayBuckets.entries()]
      .map(([date, amountPaise]) => ({ date, amountPaise }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      period: {
        key,
        label: range.label,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      collected: {
        currentPaise: collectedCurrent._sum.amountPaise ?? 0,
        previousPaise: collectedPrevious._sum.amountPaise ?? 0,
        count: collectedCurrent._count._all,
      },
      newMembers: { current: newCurrent, previous: newPrevious },
      renewals: { current: renewalsCurrent, previous: renewalsPrevious },
      expiring: { current: expiringCount },
      outstanding: {
        totalPaise: calculateBalance({
          totalBilledPaise: billedTotal._sum.totalPaise ?? 0,
          totalPaidPaise: paidTotal._sum.amountPaise ?? 0,
          totalRefundedPaise: paidTotal._sum.refundedPaise ?? 0,
        }),
        memberCount: duesMembers,
      },
      byMode: byMode.map((row) => ({
        mode: row.mode,
        amountPaise: row._sum.amountPaise ?? 0,
        count: row._count._all,
      })),
      daily,
    };
  }

  /**
   * How many members owe money.
   *
   * Done with two grouped aggregates rather than per-member queries — at a
   * few thousand members the naive version is thousands of round trips.
   */
  private async countMembersWithDues(): Promise<number> {
    const [billed, paid] = await Promise.all([
      prisma.membership.groupBy({
        by: ['memberId'],
        _sum: { totalPaise: true },
      }),
      prisma.payment.groupBy({
        by: ['memberId'],
        where: { deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
    ]);

    const paidBy = new Map(
      paid.map((row) => [
        row.memberId,
        (row._sum.amountPaise ?? 0) - (row._sum.refundedPaise ?? 0),
      ]),
    );

    let count = 0;
    for (const row of billed) {
      const owed = (row._sum.totalPaise ?? 0) - (paidBy.get(row.memberId) ?? 0);
      if (owed > 0) count++;
    }

    return count;
  }

  /** Today's collections, broken down for the front desk. */
  async getTodayCollection() {
    const from = startOfDay(new Date());
    const to = endOfDay(new Date());

    const [total, byMode, recent] = await Promise.all([
      prisma.payment.aggregate({
        where: { deletedAt: null, paidAt: { gte: from, lte: to } },
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      prisma.payment.groupBy({
        by: ['mode'],
        where: { deletedAt: null, paidAt: { gte: from, lte: to } },
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      prisma.payment.findMany({
        where: { deletedAt: null, paidAt: { gte: from, lte: to } },
        orderBy: { paidAt: 'desc' },
        take: 10,
        include: {
          member: {
            select: { id: true, memberId: true, fullName: true, photoUrl: true },
          },
        },
      }),
    ]);

    return {
      totalPaise: total._sum.amountPaise ?? 0,
      count: total._count._all,
      byMode: byMode.map((row) => ({
        mode: row.mode,
        amountPaise: row._sum.amountPaise ?? 0,
        count: row._count._all,
      })),
      recent,
    };
  }
}

export const analyticsService = new AnalyticsService();
