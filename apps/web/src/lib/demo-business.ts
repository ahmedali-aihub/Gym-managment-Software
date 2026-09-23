import { DEMO_MEMBERS } from './demo-data';
import { DEMO_PAYMENTS } from './demo-extra';

/**
 * Demo fixtures for expenses and leads.
 *
 * Costs are modelled on what a real Mehdipatnam gym actually pays: rent and
 * salaries dominate, electricity is the third line because air conditioning
 * and equipment draw heavily, and everything else is small. A demo where
 * costs are evenly spread would make the breakdown chart meaningless.
 */

let seed = 71003;
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

export interface DemoExpense {
  id: string;
  category: string;
  title: string;
  notes: string | null;
  amountPaise: number;
  incurredAt: string;
  paymentMode: string;
  paidTo: string | null;
  isRecurring: boolean;
}

/** Fixed monthly costs, repeated across the year. */
const RECURRING = [
  { category: 'RENT', title: 'Monthly rent', paise: 45_000_00, paidTo: 'Property owner' },
  { category: 'SALARIES', title: 'Staff salaries', paise: 68_000_00, paidTo: 'Staff' },
  { category: 'ELECTRICITY', title: 'Electricity bill', paise: 18_000_00, paidTo: 'TSSPDCL' },
  { category: 'WATER', title: 'Water supply', paise: 2_500_00, paidTo: 'Water board' },
  { category: 'INTERNET', title: 'Broadband', paise: 1_200_00, paidTo: 'ACT Fibernet' },
] as const;

/** Irregular costs that show up now and then. */
const ONE_OFF = [
  { category: 'EQUIPMENT', title: 'Dumbbell set (10–30 kg)', paise: 32_000_00, paidTo: 'Fitness World' },
  { category: 'MAINTENANCE', title: 'Treadmill servicing', paise: 4_500_00, paidTo: 'Service engineer' },
  { category: 'MARKETING', title: 'Instagram ads', paise: 6_000_00, paidTo: 'Meta' },
  { category: 'SUPPLIES', title: 'Cleaning supplies', paise: 1_800_00, paidTo: 'Local supplier' },
  { category: 'MAINTENANCE', title: 'AC repair', paise: 7_500_00, paidTo: 'Cool Care' },
  { category: 'MARKETING', title: 'Flyer printing', paise: 3_200_00, paidTo: 'Sri Print' },
  { category: 'EQUIPMENT', title: 'Yoga mats (20)', paise: 9_000_00, paidTo: 'Decathlon' },
  { category: 'INSURANCE', title: 'Premises insurance', paise: 12_000_00, paidTo: 'ICICI Lombard' },
] as const;

function buildExpenses(): DemoExpense[] {
  seed = 71003;
  const expenses: DemoExpense[] = [];
  const now = new Date();
  let index = 0;

  // Twelve months of fixed costs.
  for (let back = 11; back >= 0; back--) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);

    for (const item of RECURRING) {
      // Small month-to-month variation, so the chart is not a flat line.
      const variance = item.category === 'RENT' ? 1 : 0.88 + random() * 0.24;

      expenses.push({
        id: `demo-expense-${++index}`,
        category: item.category,
        title: item.title,
        notes: null,
        amountPaise: Math.round(item.paise * variance),
        incurredAt: new Date(
          month.getFullYear(),
          month.getMonth(),
          randomInt(1, 5),
        ).toISOString(),
        paymentMode: item.category === 'SALARIES' ? 'CASH' : 'NET_BANKING',
        paidTo: item.paidTo,
        isRecurring: true,
      });
    }
  }

  // Scattered one-off purchases.
  for (const item of ONE_OFF) {
    const back = randomInt(0, 11);
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);

    expenses.push({
      id: `demo-expense-${++index}`,
      category: item.category,
      title: item.title,
      notes: null,
      amountPaise: item.paise,
      incurredAt: new Date(
        month.getFullYear(),
        month.getMonth(),
        randomInt(1, 28),
      ).toISOString(),
      paymentMode: pick(['UPI', 'CARD', 'CASH'] as const),
      paidTo: item.paidTo,
      isRecurring: false,
    });
  }

  return expenses.sort(
    (a, b) => new Date(b.incurredAt).getTime() - new Date(a.incurredAt).getTime(),
  );
}

export const DEMO_EXPENSES = buildExpenses();

export function buildProfitAndLoss() {
  const now = new Date();
  const fyStart = new Date(
    now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1,
    3,
    1,
  );

  const inRange = (iso: string) => new Date(iso) >= fyStart;

  const expenses = DEMO_EXPENSES.filter((e) => inRange(e.incurredAt));
  const payments = DEMO_PAYMENTS.filter((p) => inRange(p.paidAt));

  const incomePaise = payments.reduce((sum, p) => sum + p.amountPaise, 0);
  const expensePaise = expenses.reduce((sum, e) => sum + e.amountPaise, 0);
  const netPaise = incomePaise - expensePaise;

  const byCategoryMap = new Map<string, { amountPaise: number; count: number }>();
  for (const expense of expenses) {
    const entry = byCategoryMap.get(expense.category) ?? {
      amountPaise: 0,
      count: 0,
    };
    entry.amountPaise += expense.amountPaise;
    entry.count++;
    byCategoryMap.set(expense.category, entry);
  }

  // Month buckets from the start of the financial year.
  const buckets = new Map<
    string,
    { month: string; incomePaise: number; expensePaise: number }
  >();

  const cursor = new Date(fyStart);
  while (cursor <= now) {
    buckets.set(`${cursor.getFullYear()}-${cursor.getMonth()}`, {
      month: cursor.toLocaleDateString('en-IN', { month: 'short' }),
      incomePaise: 0,
      expensePaise: 0,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  for (const payment of payments) {
    const date = new Date(payment.paidAt);
    const bucket = buckets.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (bucket) bucket.incomePaise += payment.amountPaise;
  }

  for (const expense of expenses) {
    const date = new Date(expense.incurredAt);
    const bucket = buckets.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (bucket) bucket.expensePaise += expense.amountPaise;
  }

  return {
    from: fyStart.toISOString(),
    to: now.toISOString(),
    incomePaise,
    expensePaise,
    netPaise,
    marginPercent:
      incomePaise > 0
        ? Number(((netPaise / incomePaise) * 100).toFixed(1))
        : null,
    byCategory: [...byCategoryMap.entries()]
      .map(([category, value]) => ({
        category,
        ...value,
        sharePercent:
          expensePaise > 0
            ? Number(((value.amountPaise / expensePaise) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.amountPaise - a.amountPaise),
    monthly: [...buckets.values()].map((bucket) => ({
      ...bucket,
      netPaise: bucket.incomePaise - bucket.expensePaise,
    })),
  };
}

// ── Leads ─────────────────────────────────────────────────────────────────

export interface DemoLead {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  source: string;
  status: string;
  interestedIn: string | null;
  notes: string | null;
  followUpAt: string | null;
  lostReason: string | null;
  quotedPlan: { id: string; name: string; pricePaise: number } | null;
  assignedTo: { id: string; fullName: string } | null;
  activities: Array<{ type: string; summary: string; createdAt: string }>;
}

const SOURCES = [
  'WALK_IN', 'WALK_IN', 'REFERRAL', 'INSTAGRAM',
  'PHONE', 'GOOGLE', 'WHATSAPP', 'FLYER',
] as const;

const WANTS = [
  'Weight loss',
  'Muscle gain',
  'General fitness',
  'Evening batch',
  'Morning batch only',
  'Personal training',
  'Cardio and treadmill',
] as const;

const PLANS = [
  { id: 'plan-1', name: 'Monthly', pricePaise: 150_000 },
  { id: 'plan-2', name: 'Quarterly', pricePaise: 400_000 },
  { id: 'plan-4', name: 'Yearly', pricePaise: 1_200_000 },
] as const;

const LOST_REASONS = [
  'Found a cheaper gym nearby',
  'Moved out of the area',
  'Timing did not suit',
  'Stopped responding',
] as const;

function buildLeads(): DemoLead[] {
  seed = 92117;
  const leads: DemoLead[] = [];
  const now = Date.now();

  // Names reused from the member pool, offset so they are different people.
  const namePool = DEMO_MEMBERS.slice(120, 160);

  namePool.forEach((person, index) => {
    const roll = random();

    // A realistic funnel: most are early-stage, a few converted, some lost.
    const status =
      roll < 0.2 ? 'NEW'
      : roll < 0.42 ? 'CONTACTED'
      : roll < 0.56 ? 'TRIAL_SCHEDULED'
      : roll < 0.66 ? 'TRIAL_DONE'
      : roll < 0.76 ? 'NEGOTIATING'
      : roll < 0.88 ? 'CONVERTED'
      : 'LOST';

    const closed = status === 'CONVERTED' || status === 'LOST';

    // Spread follow-ups so some are overdue — the whole point of the screen.
    const followUpOffsetDays = randomInt(-4, 10);

    const createdAt = new Date(now - randomInt(1, 40) * 86_400_000);

    const activities: DemoLead['activities'] = [
      {
        type: 'NOTE',
        summary: 'Enquiry received',
        createdAt: createdAt.toISOString(),
      },
    ];

    if (status !== 'NEW') {
      activities.unshift({
        type: 'CALL',
        summary: pick([
          'Called, asked about timings',
          'Explained plans over the phone',
          'Said they will visit this week',
          'Wants to try a session first',
        ] as const),
        createdAt: new Date(
          createdAt.getTime() + randomInt(1, 3) * 86_400_000,
        ).toISOString(),
      });
    }

    leads.push({
      id: `demo-lead-${index + 1}`,
      fullName: person.fullName,
      phone: person.phone,
      email: null,
      source: pick(SOURCES),
      status,
      interestedIn: pick(WANTS),
      notes: null,
      followUpAt: closed
        ? null
        : new Date(now + followUpOffsetDays * 86_400_000).toISOString(),
      lostReason: status === 'LOST' ? pick(LOST_REASONS) : null,
      quotedPlan: random() < 0.6 ? { ...pick(PLANS) } : null,
      assignedTo: { id: 'demo-owner', fullName: 'Priya Sharma' },
      activities,
    });
  });

  // Overdue first, matching the API's ordering.
  return leads.sort((a, b) => {
    if (!a.followUpAt) return 1;
    if (!b.followUpAt) return -1;
    return new Date(a.followUpAt).getTime() - new Date(b.followUpAt).getTime();
  });
}

export const DEMO_LEADS = buildLeads();

export function buildLeadStats() {
  const byStatus: Record<string, number> = {};
  const bySourceMap = new Map<string, number>();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  let dueToday = 0;
  let overdue = 0;

  for (const lead of DEMO_LEADS) {
    byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1;
    bySourceMap.set(lead.source, (bySourceMap.get(lead.source) ?? 0) + 1);

    if (lead.followUpAt && lead.status !== 'CONVERTED' && lead.status !== 'LOST') {
      const due = new Date(lead.followUpAt);
      if (due < startOfToday) overdue++;
      else if (due <= endOfToday) dueToday++;
    }
  }

  const converted = byStatus.CONVERTED ?? 0;

  return {
    total: DEMO_LEADS.length,
    byStatus,
    bySource: [...bySourceMap.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    dueToday,
    overdue,
    conversionRatePercent:
      DEMO_LEADS.length > 0
        ? Number(((converted / DEMO_LEADS.length) * 100).toFixed(1))
        : null,
  };
}
