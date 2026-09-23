import { formatDate, PAYMENT_MODE_LABELS } from '@azf/shared';
import { DEMO_MEMBERS, MONTH_LABELS, type DemoMember } from './demo-data';

/**
 * Demo data for the payments, SMS and member-profile screens.
 *
 * Kept separate from demo-data.ts so the member/dashboard fixtures stay
 * readable. Same deterministic approach: identical output on every reload.
 */

let seed = 55501;
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}
function chance(probability: number): boolean {
  return random() < probability;
}

const MODES = ['CASH', 'UPI', 'UPI', 'UPI', 'CARD', 'NET_BANKING'] as const;

export interface DemoPayment {
  id: string;
  amountPaise: number;
  mode: (typeof MODES)[number];
  paidAt: string;
  reference: string | null;
  notes: string | null;
  member: {
    id: string;
    memberId: string;
    fullName: string;
    phone: string;
  };
  invoice: { id: string; invoiceNumber: string } | null;
  collectedBy: { fullName: string } | null;
}

function reference(mode: string): string | null {
  switch (mode) {
    case 'UPI':
      return String(randomInt(100000000000, 999999999999));
    case 'CARD':
      return `AUTH${randomInt(100000, 999999)}`;
    case 'NET_BANKING':
      return `NB${randomInt(10000000, 99999999)}`;
    default:
      return null;
  }
}

function buildPayments(): DemoPayment[] {
  seed = 55501;
  const payments: DemoPayment[] = [];
  const now = Date.now();

  // Paid members generate one or two payments each.
  const payers = DEMO_MEMBERS.filter((m) => m.balanceDuePaise === 0).slice(0, 90);

  payers.forEach((member, index) => {
    const mode = pick(MODES);
    const daysAgo = randomInt(0, 180);

    payments.push({
      id: `demo-payment-${index + 1}`,
      amountPaise:
        [150_000, 400_000, 700_000, 1_200_000][randomInt(0, 3)] ?? 400_000,
      mode,
      paidAt: new Date(now - daysAgo * 86_400_000).toISOString(),
      reference: reference(mode),
      notes: null,
      member: {
        id: member.id,
        memberId: member.memberId,
        fullName: member.fullName,
        phone: member.phone,
      },
      invoice: {
        id: `demo-invoice-${index + 1}`,
        invoiceNumber: `RCPT/2026-27/${String(index + 1).padStart(4, '0')}`,
      },
      collectedBy: { fullName: chance(0.7) ? 'Priya Sharma' : 'Srinivas Reddy' },
    });
  });

  return payments.sort(
    (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
  );
}

export const DEMO_PAYMENTS = buildPayments();

export function buildPaymentStats() {
  const collected = DEMO_PAYMENTS.reduce((s, p) => s + p.amountPaise, 0);
  const pending = DEMO_MEMBERS.reduce((s, m) => s + m.balanceDuePaise, 0);

  const byMode = {
    CASH: { count: 0, amountPaise: 0 },
    UPI: { count: 0, amountPaise: 0 },
    CARD: { count: 0, amountPaise: 0 },
    NET_BANKING: { count: 0, amountPaise: 0 },
    ONLINE: { count: 0, amountPaise: 0 },
  };

  for (const payment of DEMO_PAYMENTS) {
    const bucket = byMode[payment.mode];
    bucket.count++;
    bucket.amountPaise += payment.amountPaise;
  }

  return {
    collectedPaise: collected,
    pendingPaise: pending,
    refundedPaise: 0,
    discountPaise: 0,
    transactionCount: DEMO_PAYMENTS.length,
    byMode,
  };
}

// ── SMS ───────────────────────────────────────────────────────────────────

export interface DemoSmsLog {
  id: string;
  toPhone: string;
  templateKey: string;
  body: string;
  status: string;
  provider: string;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  segments: number;
  createdAt: string;
  sentAt: string | null;
  member: { id: string; memberId: string; fullName: string } | null;
}

/** Failures a real gateway actually returns, so the UI shows real text. */
const FAILURES = [
  {
    code: 'DND_BLOCKED',
    message: 'Number is registered on the DND registry',
    status: 'DEAD',
  },
  {
    code: 'INVALID_NUMBER',
    message: 'The destination number is not valid',
    status: 'DEAD',
  },
  {
    code: 'GATEWAY_TIMEOUT',
    message: 'Upstream gateway did not respond',
    status: 'FAILED',
  },
] as const;

function buildSmsLogs(): DemoSmsLog[] {
  seed = 88803;
  const logs: DemoSmsLog[] = [];
  const now = Date.now();

  const templates = [
    {
      key: 'WELCOME',
      body: (m: DemoMember) =>
        `Welcome to A to Z Fitness, ${m.fullName.split(' ')[0]}! Your ID: ${m.memberId}. Plan: ${m.memberships[0]!.plan.name}. Queries: +91 90000 00000`,
    },
    {
      key: 'EXPIRY_REMINDER',
      body: (m: DemoMember) =>
        `Hi ${m.fullName.split(' ')[0]}, your A to Z Fitness membership (${m.memberId}) expires soon. Renew now to keep training. Call +91 90000 00000`,
    },
    {
      key: 'DUES_REMINDER',
      body: (m: DemoMember) =>
        `Hi ${m.fullName.split(' ')[0]}, a balance of Rs.${Math.round(m.balanceDuePaise / 100)} is pending on your A to Z Fitness membership (${m.memberId}).`,
    },
    {
      key: 'BIRTHDAY',
      body: (m: DemoMember) =>
        `Happy Birthday ${m.fullName.split(' ')[0]}! Wishing you a strong and healthy year ahead. - Team A to Z Fitness`,
    },
  ];

  DEMO_MEMBERS.slice(0, 40).forEach((member, index) => {
    const template = pick(templates);
    const body = template.body(member);

    // ~12% fail, which is realistic for Indian transactional SMS once DND
    // blocks are counted.
    const failed = chance(0.12);
    const failure = failed ? pick(FAILURES) : null;

    logs.push({
      id: `demo-sms-${index + 1}`,
      toPhone: `+91${member.phone}`,
      templateKey: template.key,
      body,
      status: failure ? failure.status : chance(0.8) ? 'DELIVERED' : 'SENT',
      provider: 'MOCK',
      errorCode: failure?.code ?? null,
      errorMessage: failure?.message ?? null,
      attempts: failure ? randomInt(1, 3) : 1,
      maxAttempts: 3,
      segments: body.length > 160 ? 2 : 1,
      createdAt: new Date(now - randomInt(0, 72) * 3_600_000).toISOString(),
      sentAt: failure ? null : new Date(now - randomInt(0, 72) * 3_600_000).toISOString(),
      member: {
        id: member.id,
        memberId: member.memberId,
        fullName: member.fullName,
      },
    });
  });

  return logs.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export const DEMO_SMS_LOGS = buildSmsLogs();

export const DEMO_SMS_FAILED = DEMO_SMS_LOGS.filter(
  (log) => log.status === 'FAILED' || log.status === 'DEAD',
);

export function buildSmsStats() {
  const counts = { QUEUED: 0, SENDING: 0, SENT: 0, DELIVERED: 0, FAILED: 0, DEAD: 0 };

  for (const log of DEMO_SMS_LOGS) {
    counts[log.status as keyof typeof counts]++;
  }

  const total = DEMO_SMS_LOGS.length;

  return {
    total,
    queued: counts.QUEUED,
    sent: counts.SENT,
    delivered: counts.DELIVERED,
    failed: counts.FAILED,
    dead: counts.DEAD,
    deliveryRate: total > 0 ? ((counts.DELIVERED + counts.SENT) / total) * 100 : 0,
    segmentsUsed: DEMO_SMS_LOGS.reduce((s, l) => s + l.segments, 0),
  };
}

// ── Member profile ────────────────────────────────────────────────────────

/** A 1x1 transparent PNG standing in for a generated QR code. */
const PLACEHOLDER_QR =
  'data:image/svg+xml;base64,' +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">
      <rect width="100" height="100" fill="#fff"/>
      <g fill="#1a1a1a">
        ${Array.from({ length: 144 }, (_, i) => {
          const x = (i % 12) * 8 + 2;
          const y = Math.floor(i / 12) * 8 + 2;
          // Deterministic pseudo-pattern so it looks like a real QR code.
          return (i * 7 + Math.floor(i / 12) * 3) % 3 === 0
            ? `<rect x="${x}" y="${y}" width="7" height="7"/>`
            : '';
        }).join('')}
      </g>
    </svg>`,
  );

export function buildMemberProfile(member: DemoMember) {
  seed = 33301;
  const now = Date.now();

  const payments = DEMO_PAYMENTS.filter(
    (p) => p.member.id === member.id,
  ).slice(0, 10);

  // A plausible visit history for the last few weeks.
  const attendance = Array.from({ length: randomInt(5, 20) }, (_, i) => {
    const checkIn = new Date(now - (i * 2 + randomInt(0, 2)) * 86_400_000);
    checkIn.setHours(chance(0.42) ? randomInt(6, 9) : randomInt(17, 21));

    return {
      id: `demo-visit-${member.id}-${i}`,
      checkInAt: checkIn.toISOString(),
      checkOutAt: chance(0.85)
        ? new Date(checkIn.getTime() + randomInt(35, 110) * 60_000).toISOString()
        : null,
    };
  });

  const membership = member.memberships[0]!;
  const billed =
    { Monthly: 150_000, Quarterly: 400_000, 'Half-Yearly': 700_000, Yearly: 1_200_000 }[
      membership.plan.name
    ] ?? 400_000;

  return {
    ...member,
    dateOfBirth: new Date(
      1990 + randomInt(0, 18),
      randomInt(0, 11),
      randomInt(1, 28),
    ).toISOString(),
    gender: 'MALE',
    addressLine1: `${randomInt(1, 99)}-${randomInt(1, 199)}, Main Road`,
    city: 'Hyderabad',
    pincode: '500028',
    emergencyContactName: chance(0.7) ? 'Ramesh Kumar' : null,
    emergencyContactPhone: chance(0.7) ? '9876543210' : null,
    emergencyContactRelation: chance(0.7) ? 'Father' : null,
    goals: ['WEIGHT_LOSS', 'GENERAL_FITNESS'],
    medicalNotes: chance(0.15)
      ? 'Previous knee injury (right). Avoid deep squats.'
      : null,
    qrDataUrl: PLACEHOLDER_QR,
    balance: {
      totalBilledPaise: billed,
      totalPaidPaise: billed - member.balanceDuePaise,
      totalRefundedPaise: 0,
      balanceDuePaise: member.balanceDuePaise,
    },
    memberships: [
      {
        id: membership.id,
        startDate: member.joinedAt,
        endDate: membership.endDate,
        status: member.status === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED',
        totalPaise: billed,
        plan: { name: membership.plan.name },
      },
    ],
    payments,
    attendance,
  };
}

// ── Period analytics ──────────────────────────────────────────────────────

const PERIOD_LABELS: Record<string, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time',
};

/**
 * Analytics for a period, derived from the demo payments so the figures stay
 * internally consistent with the ledger the user can scroll through.
 */
export function buildPeriodAnalytics(
  period: string,
  custom?: { from: string; to: string },
) {
  const now = new Date();
  let from: Date;
  // Every preset runs up to the present moment; only a custom range ends
  // earlier, so `to` is a variable rather than `now` inlined everywhere.
  let to = now;
  let previousFrom: Date;
  let previousTo: Date;

  switch (period) {
    case 'custom': {
      // Mirrors resolvePeriod on the API: whole days, and a previous window
      // of the SAME LENGTH immediately before.
      const parse = (iso: string, fallback: Date) => {
        const [y, m, d] = iso.split('-').map(Number);
        if (!y || !m || !d) return new Date(fallback);
        return new Date(y, m - 1, d);
      };

      from = parse(custom?.from ?? '', now);
      from.setHours(0, 0, 0, 0);
      const endDay = parse(custom?.to ?? '', now);
      endDay.setHours(0, 0, 0, 0);
      to = new Date(endDay);
      to.setHours(23, 59, 59, 999);

      const dayMs = 86_400_000;
      const days = Math.round((endDay.getTime() - from.getTime()) / dayMs) + 1;

      previousTo = new Date(from);
      previousTo.setDate(previousTo.getDate() - 1);
      previousTo.setHours(23, 59, 59, 999);

      previousFrom = new Date(previousTo);
      previousFrom.setDate(previousFrom.getDate() - (days - 1));
      previousFrom.setHours(0, 0, 0, 0);
      break;
    }
    case 'today':
      from = new Date(now); from.setHours(0, 0, 0, 0);
      previousFrom = new Date(from.getTime() - 86_400_000);
      previousTo = new Date(from.getTime() - 1);
      break;
    case 'week':
      from = new Date(now);
      from.setDate(from.getDate() - ((now.getDay() + 6) % 7));
      from.setHours(0, 0, 0, 0);
      previousFrom = new Date(from.getTime() - 7 * 86_400_000);
      previousTo = new Date(from.getTime() - 1);
      break;
    case 'quarter':
      from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      previousFrom = new Date(from.getFullYear(), from.getMonth() - 3, 1);
      previousTo = new Date(from.getTime() - 1);
      break;
    case 'year':
      from = new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1);
      previousFrom = new Date(from.getFullYear() - 1, 3, 1);
      previousTo = new Date(from.getTime() - 1);
      break;
    case 'all':
      from = new Date(2000, 0, 1);
      previousFrom = from;
      previousTo = from;
      break;
    case 'month':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      previousFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousTo = new Date(from.getTime() - 1);
  }

  const inRange = (iso: string, a: Date, b: Date) => {
    const t = new Date(iso).getTime();
    return t >= a.getTime() && t <= b.getTime();
  };

  const current = DEMO_PAYMENTS.filter((p) => inRange(p.paidAt, from, to));
  const previous = DEMO_PAYMENTS.filter((p) =>
    inRange(p.paidAt, previousFrom, previousTo),
  );

  const currentPaise = current.reduce((s, p) => s + p.amountPaise, 0);
  const previousPaise = previous.reduce((s, p) => s + p.amountPaise, 0);

  const newCurrent = DEMO_MEMBERS.filter((m) =>
    inRange(m.joinedAt, from, to),
  ).length;
  const newPrevious = DEMO_MEMBERS.filter((m) =>
    inRange(m.joinedAt, previousFrom, previousTo),
  ).length;

  const byModeMap = new Map<string, { amountPaise: number; count: number }>();
  for (const payment of current) {
    const entry = byModeMap.get(payment.mode) ?? { amountPaise: 0, count: 0 };
    entry.amountPaise += payment.amountPaise;
    entry.count++;
    byModeMap.set(payment.mode, entry);
  }

  const dayBuckets = new Map<string, number>();
  for (const payment of current) {
    const key = payment.paidAt.slice(0, 10);
    dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + payment.amountPaise);
  }

  const withDues = DEMO_MEMBERS.filter((m) => m.balanceDuePaise > 0);

  return {
    period: {
      key: period,
      label:
        period === 'custom'
          ? formatDate(from) === formatDate(to)
            ? formatDate(from)
            : `${formatDate(from)} – ${formatDate(to)}`
          : (PERIOD_LABELS[period] ?? 'This month'),
      from: from.toISOString(),
      to: to.toISOString(),
    },
    collected: { currentPaise, previousPaise, count: current.length },
    newMembers: { current: newCurrent, previous: newPrevious },
    // Renewals are not modelled in the fixtures; derived as a plausible
    // fraction of new joins so the card is not permanently zero.
    renewals: {
      current: Math.round(newCurrent * 0.6),
      previous: Math.round(newPrevious * 0.6),
    },
    expiring: { current: 0 },
    outstanding: {
      totalPaise: withDues.reduce((s, m) => s + m.balanceDuePaise, 0),
      memberCount: withDues.length,
    },
    byMode: [...byModeMap.entries()].map(([mode, v]) => ({ mode, ...v })),
    daily: [...dayBuckets.entries()]
      .map(([date, amountPaise]) => ({ date, amountPaise }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** Today's collections, for the front-desk card. */
export function buildTodayCollection() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);

  // The fixtures spread payments over months, so few land on today. Take the
  // most recent handful and re-stamp them so the card always has content.
  const today = DEMO_PAYMENTS.slice(0, 6).map((payment, index) => ({
    ...payment,
    paidAt: new Date(Date.now() - (index * 47 + 12) * 60_000).toISOString(),
  }));

  const byModeMap = new Map<string, { amountPaise: number; count: number }>();
  for (const payment of today) {
    const entry = byModeMap.get(payment.mode) ?? { amountPaise: 0, count: 0 };
    entry.amountPaise += payment.amountPaise;
    entry.count++;
    byModeMap.set(payment.mode, entry);
  }

  return {
    totalPaise: today.reduce((s, p) => s + p.amountPaise, 0),
    count: today.length,
    byMode: [...byModeMap.entries()].map(([mode, v]) => ({ mode, ...v })),
    recent: today.map((payment) => ({
      id: payment.id,
      amountPaise: payment.amountPaise,
      mode: payment.mode,
      paidAt: payment.paidAt,
      member: {
        id: payment.member.id,
        memberId: payment.member.memberId,
        fullName: payment.member.fullName,
        photoUrl: null,
      },
    })),
  };
}

/**
 * Period-scoped dashboard charts.
 *
 * Lives here rather than in demo-data.ts because it reads DEMO_PAYMENTS, and
 * demo-extra already imports demo-data — the reverse import would be a cycle.
 *
 * Unlike the unscoped `buildDashboard`, these are derived from the actual
 * fixtures rather than a synthetic curve, so the charts genuinely respond to
 * the filter instead of showing the same shape whatever the owner picks.
 */
function demoBuckets(from: Date, to: Date) {
  const dayMs = 86_400_000;
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  const days = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;
  const keys: Array<{ key: string; label: string }> = [];

  // Mirrors the API's threshold: days for a short window, months for a long
  // one. A week bucketed by month is one bar that answers nothing.
  if (days <= 70) {
    const cursor = new Date(start);
    while (cursor <= end) {
      keys.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`,
        label: cursor.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
        }),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return {
      keys,
      keyOf: (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
    };
  }

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    keys.push({
      key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
      label: MONTH_LABELS[cursor.getMonth()]!,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return {
    keys,
    keyOf: (d: Date) => `${d.getFullYear()}-${d.getMonth()}`,
  };
}

export function buildScopedCharts(from: Date, to: Date) {
  const { keys, keyOf } = demoBuckets(from, to);
  const now = new Date();

  const revenue = new Map(
    keys.map(({ key, label }) => [
      key,
      { month: label, collectedPaise: 0, pendingPaise: 0 },
    ]),
  );
  const growth = new Map(
    keys.map(({ key, label }) => [
      key,
      { month: label, joined: 0, expired: 0 },
    ]),
  );
  const modeTotals = new Map<string, number>();

  for (const payment of DEMO_PAYMENTS) {
    const paid = new Date(payment.paidAt);
    if (paid < from || paid > to) continue;

    const bucket = revenue.get(keyOf(paid));
    if (bucket) bucket.collectedPaise += payment.amountPaise;

    const label = PAYMENT_MODE_LABELS[payment.mode] ?? payment.mode;
    modeTotals.set(label, (modeTotals.get(label) ?? 0) + payment.amountPaise);
  }

  for (const member of DEMO_MEMBERS) {
    const joined = new Date(member.joinedAt);
    if (joined >= from && joined <= to) {
      const bucket = growth.get(keyOf(joined));
      if (bucket) bucket.joined++;
    }

    const membership = member.memberships[0];
    if (!membership) continue;
    const end = new Date(membership.endDate);
    // Only memberships that have actually lapsed count as an expiry; a
    // future end date is a live membership, not a loss.
    if (end >= from && end <= to && end < now) {
      const bucket = growth.get(keyOf(end));
      if (bucket) bucket.expired++;
    }
  }

  return {
    revenueTrend: [...revenue.values()],
    memberGrowth: [...growth.values()],
    paymentModes: [...modeTotals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  };
}

/**
 * Sample audit trail for one member.
 *
 * Deterministic, derived from the member's own id, so the same member always
 * shows the same history rather than reshuffling on every reload.
 *
 * The shapes mirror what the API writes: only the CHANGED fields appear in
 * before/after, never a whole-row snapshot, and never a credential.
 */
export function buildMemberHistory(member: DemoMember) {
  const joined = new Date(member.joinedAt);
  const staff = ['Priya Sharma', 'Srinivas Reddy', 'Ahmed Khan'];
  const pick = (offset: number) =>
    staff[(member.memberId.charCodeAt(member.memberId.length - 1) + offset) % staff.length]!;

  const at = (daysAfterJoin: number) => {
    const date = new Date(joined);
    date.setDate(date.getDate() + daysAfterJoin);
    date.setHours(10 + (daysAfterJoin % 8), 15 + (daysAfterJoin % 40), 0, 0);
    return date.toISOString();
  };

  const entries: Array<Record<string, unknown>> = [
    {
      id: `${member.id}-audit-1`,
      action: 'MEMBER_REGISTERED',
      entityType: 'Member',
      entityId: member.id,
      actorName: pick(0),
      actorRole: 'RECEPTIONIST',
      before: null,
      after: {
        memberId: member.memberId,
        fullName: member.fullName,
        phone: member.phone,
        plan: member.memberships[0]?.plan.name ?? 'Monthly',
        amountPaidPaise: member.totalPaidPaise,
      },
      createdAt: at(0),
    },
  ];

  // A phone correction — the most common real edit at a front desk.
  if (member.memberId.endsWith('1') || member.memberId.endsWith('4')) {
    entries.push({
      id: `${member.id}-audit-2`,
      action: 'MEMBER_UPDATED',
      entityType: 'Member',
      entityId: member.id,
      actorName: pick(1),
      actorRole: 'MANAGER',
      before: { phone: '+91 90000 00000' },
      after: { phone: member.phone },
      createdAt: at(9),
    });
  }

  if (member.balanceDuePaise > 0) {
    entries.push({
      id: `${member.id}-audit-3`,
      action: 'MEMBER_UPDATED',
      entityType: 'Member',
      entityId: member.id,
      actorName: pick(2),
      actorRole: 'OWNER',
      before: { notes: null },
      after: { notes: 'Balance to be settled next visit' },
      createdAt: at(21),
    });
  }

  // Newest first, matching the API's ordering.
  return entries.reverse();
}
