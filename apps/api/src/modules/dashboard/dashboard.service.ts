import { MemberStatus, MembershipStatus } from '@azf/shared';
import { prisma } from '../../lib/prisma.js';
import { calculateBalance } from '../payments/billing.js';

/**
 * Dashboard aggregation.
 *
 * Each figure is computed with a grouped query rather than fetched-then-
 * counted in JavaScript. With 200 members that difference is invisible; at
 * 2,000 it is the difference between a snappy dashboard and a spinner.
 */

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short' });
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** An explicit window for the range-scoped chart queries. */
export interface ChartRange {
  from: Date;
  to: Date;
}

/**
 * Time buckets spanning a range.
 *
 * GRANULARITY FOLLOWS THE RANGE. A week bucketed by month is a single bar
 * that answers nothing, and three years bucketed by day is 1,000 unreadable
 * slivers. The thresholds below keep every chart between roughly 7 and 31
 * marks, which is what the column and diverging forms are drawn for.
 *
 * Buckets are PRE-SEEDED so a period with no activity renders as a zero
 * rather than vanishing — a missing bar distorts the axis and reads as
 * "no data" when it means "no business".
 */
function buildBuckets(range: ChartRange): {
  unit: 'day' | 'month';
  keyOf: (date: Date) => string;
  keys: Array<{ key: string; label: string }>;
} {
  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(range.from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(range.to);
  end.setHours(0, 0, 0, 0);

  const days = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;

  // Up to ~10 weeks reads well as days; beyond that, months.
  if (days <= 70) {
    const keys: Array<{ key: string; label: string }> = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      keys.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`,
        label: dayLabel(cursor),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      unit: 'day',
      keyOf: (date) =>
        `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      keys,
    };
  }

  const keys: Array<{ key: string; label: string }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= last) {
    keys.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: monthLabel(cursor),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return {
    unit: 'month',
    keyOf: (date) => `${date.getFullYear()}-${date.getMonth()}`,
    keys,
  };
}

class DashboardService {
  async getOverview() {
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );
    const lastMonthEnd = endOfMonth(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );

    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);
    weekAhead.setHours(23, 59, 59, 999);

    const [
      statusCounts,
      expiringSoon,
      joinsThisMonth,
      joinsLastMonth,
      revenueThisMonth,
      revenueLastMonth,
      totalBilled,
      totalPaid,
      expiredLastMonth,
      activeAtStartOfLastMonth,
    ] = await Promise.all([
      prisma.member.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.member.count({
        where: {
          deletedAt: null,
          memberships: {
            some: {
              status: MembershipStatus.ACTIVE,
              endDate: { gte: now, lte: weekAhead },
            },
          },
        },
      }),
      prisma.member.count({
        where: { deletedAt: null, joinedAt: { gte: thisMonthStart } },
      }),
      prisma.member.count({
        where: {
          deletedAt: null,
          joinedAt: { gte: lastMonthStart, lte: lastMonthEnd },
        },
      }),
      prisma.payment.aggregate({
        where: { deletedAt: null, paidAt: { gte: thisMonthStart } },
        _sum: { amountPaise: true },
      }),
      prisma.payment.aggregate({
        where: {
          deletedAt: null,
          paidAt: { gte: lastMonthStart, lte: lastMonthEnd },
        },
        _sum: { amountPaise: true },
      }),
      prisma.membership.aggregate({ _sum: { totalPaise: true } }),
      prisma.payment.aggregate({
        where: { deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
      // Churn inputs: memberships that lapsed last month, against the base
      // that was active going into it.
      prisma.membership.count({
        where: {
          status: MembershipStatus.EXPIRED,
          endDate: { gte: lastMonthStart, lte: lastMonthEnd },
        },
      }),
      prisma.membership.count({
        where: {
          startDate: { lt: lastMonthStart },
          endDate: { gte: lastMonthStart },
        },
      }),
    ]);

    const byStatus = new Map(statusCounts.map((s) => [s.status, s._count._all]));
    const total = statusCounts.reduce((sum, s) => sum + s._count._all, 0);

    const collectedPaise = totalPaid._sum.amountPaise ?? 0;
    const pendingPaise = calculateBalance({
      totalBilledPaise: totalBilled._sum.totalPaise ?? 0,
      totalPaidPaise: collectedPaise,
      totalRefundedPaise: totalPaid._sum.refundedPaise ?? 0,
    });

    // Churn as a percentage of the base that could have lapsed. Guarded
    // against a zero base, which would otherwise produce Infinity.
    const churnRate =
      activeAtStartOfLastMonth > 0
        ? (expiredLastMonth / activeAtStartOfLastMonth) * 100
        : 0;

    return {
      members: {
        total,
        active: byStatus.get(MemberStatus.ACTIVE) ?? 0,
        expired: byStatus.get(MemberStatus.EXPIRED) ?? 0,
        frozen: byStatus.get(MemberStatus.FROZEN) ?? 0,
        cancelled: byStatus.get(MemberStatus.CANCELLED) ?? 0,
        expiringSoon,
      },
      joins: {
        thisMonth: joinsThisMonth,
        lastMonth: joinsLastMonth,
      },
      revenue: {
        thisMonthPaise: revenueThisMonth._sum.amountPaise ?? 0,
        lastMonthPaise: revenueLastMonth._sum.amountPaise ?? 0,
        collectedPaise,
        pendingPaise,
      },
      retention: {
        churnRatePercent: Number(churnRate.toFixed(1)),
        retentionRatePercent: Number((100 - churnRate).toFixed(1)),
      },
    };
  }

  /**
   * Revenue over a window, for the trend chart.
   *
   * Defaults to the trailing twelve months. A `range` scopes it to whatever
   * period the owner picked, bucketed by day or month to suit its length.
   */
  async getRevenueTrend(months = 12, range?: ChartRange) {
    const now = new Date();
    const window: ChartRange = range ?? {
      from: startOfMonth(
        new Date(now.getFullYear(), now.getMonth() - (months - 1), 1),
      ),
      to: now,
    };

    const { keyOf, keys } = buildBuckets(window);

    const payments = await prisma.payment.findMany({
      where: {
        deletedAt: null,
        paidAt: { gte: window.from, lte: window.to },
      },
      select: { paidAt: true, amountPaise: true },
    });

    // Pre-seed every bucket so a period with no payments renders as a zero
    // rather than vanishing and distorting the x-axis.
    const buckets = new Map<string, { month: string; collectedPaise: number }>(
      keys.map(({ key, label }) => [key, { month: label, collectedPaise: 0 }]),
    );

    for (const payment of payments) {
      const bucket = buckets.get(keyOf(payment.paidAt));
      if (bucket) bucket.collectedPaise += payment.amountPaise;
    }

    return [...buckets.values()].map((b) => ({ ...b, pendingPaise: 0 }));
  }

  /** New joins vs. expiries per bucket, over a window. */
  async getMemberGrowth(months = 12, range?: ChartRange) {
    const now = new Date();
    const window: ChartRange = range ?? {
      from: startOfMonth(
        new Date(now.getFullYear(), now.getMonth() - (months - 1), 1),
      ),
      to: now,
    };

    const { keyOf, keys } = buildBuckets(window);

    const [joined, expired] = await Promise.all([
      prisma.member.findMany({
        where: {
          deletedAt: null,
          joinedAt: { gte: window.from, lte: window.to },
        },
        select: { joinedAt: true },
      }),
      prisma.membership.findMany({
        where: {
          status: MembershipStatus.EXPIRED,
          endDate: { gte: window.from, lte: window.to },
        },
        select: { endDate: true },
      }),
    ]);

    const buckets = new Map<
      string,
      { month: string; joined: number; expired: number }
    >(
      keys.map(({ key, label }) => [
        key,
        { month: label, joined: 0, expired: 0 },
      ]),
    );

    for (const member of joined) {
      const bucket = buckets.get(keyOf(member.joinedAt));
      if (bucket) bucket.joined++;
    }

    for (const membership of expired) {
      const bucket = buckets.get(keyOf(membership.endDate));
      if (bucket) bucket.expired++;
    }

    return [...buckets.values()];
  }

  /** Check-in counts by weekday and hour, for the heatmap. */
  async getPeakHours(days = 90) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const checkIns = await prisma.attendance.findMany({
      where: { checkInAt: { gte: since } },
      select: { checkInAt: true },
    });

    const counts = new Map<string, number>();

    for (const record of checkIns) {
      // JS weeks start on Sunday; the heatmap starts on Monday.
      const day = (record.checkInAt.getDay() + 6) % 7;
      const hour = record.checkInAt.getHours();
      const key = `${day}-${hour}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()].map(([key, count]) => {
      const [day, hour] = key.split('-').map(Number);
      return { day: day ?? 0, hour: hour ?? 0, count };
    });
  }

  /** Most recent check-ins, for the live feed. */
  async getRecentCheckIns(limit = 10) {
    return prisma.attendance.findMany({
      take: limit,
      orderBy: { checkInAt: 'desc' },
      include: {
        member: {
          select: {
            id: true,
            memberId: true,
            fullName: true,
            photoUrl: true,
          },
        },
      },
    });
  }

  /** Collected totals split by payment mode, over a window. */
  async getPaymentModeSplit(days = 90, range?: ChartRange) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const where = range
      ? { deletedAt: null, paidAt: { gte: range.from, lte: range.to } }
      : { deletedAt: null, paidAt: { gte: since } };

    const grouped = await prisma.payment.groupBy({
      by: ['mode'],
      where,
      _sum: { amountPaise: true },
    });

    const LABELS: Record<string, string> = {
      CASH: 'Cash',
      UPI: 'UPI',
      CARD: 'Card',
      NET_BANKING: 'Net Banking',
      ONLINE: 'Online',
    };

    return grouped
      .map((row) => ({
        name: LABELS[row.mode] ?? row.mode,
        value: row._sum.amountPaise ?? 0,
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
  }
}

export const dashboardService = new DashboardService();
