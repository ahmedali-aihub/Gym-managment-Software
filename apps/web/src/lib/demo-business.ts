import { DEMO_PAYMENTS } from './demo-extra';

/**
 * Demo fixtures for expenses.
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
