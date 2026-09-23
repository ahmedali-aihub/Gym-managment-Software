import { describe, expect, it, vi } from 'vitest';

/**
 * Profit and loss.
 *
 * The arithmetic is simple; the judgement calls are not. These tests pin down
 * three decisions that would otherwise drift:
 *
 *  • Income means COLLECTED, not billed.
 *  • Refunds reduce income — money that left again was never income.
 *  • A margin on zero income is undefined, not zero.
 */

interface FakePayment {
  paidAt: Date;
  amountPaise: number;
  refundedPaise: number;
}

interface FakeExpense {
  incurredAt: Date;
  amountPaise: number;
  category: string;
}

let payments: FakePayment[] = [];
let expenses: FakeExpense[] = [];

const prismaFake = {
  payment: {
    aggregate: vi.fn(async () => ({
      _sum: {
        amountPaise: payments.reduce((s, p) => s + p.amountPaise, 0),
        refundedPaise: payments.reduce((s, p) => s + p.refundedPaise, 0),
      },
    })),
    findMany: vi.fn(async () => payments),
  },
  expense: {
    aggregate: vi.fn(async () => ({
      _sum: { amountPaise: expenses.reduce((s, e) => s + e.amountPaise, 0) },
    })),
    findMany: vi.fn(async () => expenses),
    groupBy: vi.fn(async () => {
      const byCategory = new Map<string, { sum: number; count: number }>();
      for (const expense of expenses) {
        const entry = byCategory.get(expense.category) ?? { sum: 0, count: 0 };
        entry.sum += expense.amountPaise;
        entry.count++;
        byCategory.set(expense.category, entry);
      }
      return [...byCategory.entries()].map(([category, value]) => ({
        category,
        _sum: { amountPaise: value.sum },
        _count: { _all: value.count },
      }));
    }),
  },
};

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: prismaFake,
  isPrismaError: () => false,
  PrismaErrorCode: {},
}));

const { expensesService } = await import(
  '../../src/modules/expenses/expenses.service.js'
);

const FROM = new Date(2026, 3, 1);
const TO = new Date(2026, 8, 30, 23, 59, 59);

function setUp(p: FakePayment[], e: FakeExpense[]) {
  payments = p;
  expenses = e;
}

describe('profit and loss', () => {
  it('computes net as income minus expenses', async () => {
    setUp(
      [{ paidAt: new Date(2026, 5, 10), amountPaise: 500_000, refundedPaise: 0 }],
      [{ incurredAt: new Date(2026, 5, 5), amountPaise: 300_000, category: 'RENT' }],
    );

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    expect(result.incomePaise).toBe(500_000);
    expect(result.expensePaise).toBe(300_000);
    expect(result.netPaise).toBe(200_000);
  });

  it('nets refunds off income', async () => {
    // A ₹5,000 payment with ₹1,000 refunded is ₹4,000 of income. Reporting
    // the gross figure overstates what the gym actually kept.
    setUp(
      [
        {
          paidAt: new Date(2026, 5, 10),
          amountPaise: 500_000,
          refundedPaise: 100_000,
        },
      ],
      [],
    );

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    expect(result.incomePaise).toBe(400_000);
    expect(result.netPaise).toBe(400_000);
  });

  it('reports a loss as a negative net', async () => {
    setUp(
      [{ paidAt: new Date(2026, 5, 10), amountPaise: 200_000, refundedPaise: 0 }],
      [{ incurredAt: new Date(2026, 5, 5), amountPaise: 350_000, category: 'RENT' }],
    );

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    // Clamping a loss to zero would hide exactly the situation the owner
    // most needs to see.
    expect(result.netPaise).toBe(-150_000);
    expect(result.marginPercent).toBe(-75);
  });

  it('computes margin as a percentage of income', async () => {
    setUp(
      [{ paidAt: new Date(2026, 5, 10), amountPaise: 1_000_000, refundedPaise: 0 }],
      [{ incurredAt: new Date(2026, 5, 5), amountPaise: 700_000, category: 'RENT' }],
    );

    const result = await expensesService.getProfitAndLoss(FROM, TO);
    expect(result.marginPercent).toBe(30);
  });

  it('returns a null margin when there was no income', async () => {
    // Dividing by zero would give Infinity or NaN; the UI renders "—".
    setUp([], [
      { incurredAt: new Date(2026, 5, 5), amountPaise: 300_000, category: 'RENT' },
    ]);

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    expect(result.marginPercent).toBeNull();
    expect(result.netPaise).toBe(-300_000);
  });

  it('handles a month with no activity at all', async () => {
    setUp([], []);

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    expect(result.incomePaise).toBe(0);
    expect(result.expensePaise).toBe(0);
    expect(result.netPaise).toBe(0);
    expect(result.marginPercent).toBeNull();
  });
});

describe('category breakdown', () => {
  it('shares sum to 100 percent', async () => {
    setUp([], [
      { incurredAt: new Date(2026, 5, 1), amountPaise: 500_000, category: 'RENT' },
      { incurredAt: new Date(2026, 5, 2), amountPaise: 300_000, category: 'SALARIES' },
      { incurredAt: new Date(2026, 5, 3), amountPaise: 200_000, category: 'ELECTRICITY' },
    ]);

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    const total = result.byCategory.reduce(
      (sum, row) => sum + row.sharePercent,
      0,
    );
    expect(total).toBeCloseTo(100, 1);
  });

  it('orders categories by spend, largest first', async () => {
    setUp([], [
      { incurredAt: new Date(2026, 5, 1), amountPaise: 100_000, category: 'SUPPLIES' },
      { incurredAt: new Date(2026, 5, 2), amountPaise: 800_000, category: 'RENT' },
      { incurredAt: new Date(2026, 5, 3), amountPaise: 400_000, category: 'SALARIES' },
    ]);

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    expect(result.byCategory.map((r) => r.category)).toEqual([
      'RENT',
      'SALARIES',
      'SUPPLIES',
    ]);
  });

  it('does not divide by zero when there are no expenses', async () => {
    setUp(
      [{ paidAt: new Date(2026, 5, 10), amountPaise: 500_000, refundedPaise: 0 }],
      [],
    );

    const result = await expensesService.getProfitAndLoss(FROM, TO);
    expect(result.byCategory).toEqual([]);
  });
});

describe('monthly buckets', () => {
  it('includes months with no activity', async () => {
    // A quiet month must still appear, or the chart silently compresses the
    // timeline and makes a gap look like continuity.
    setUp(
      [{ paidAt: new Date(2026, 3, 10), amountPaise: 100_000, refundedPaise: 0 }],
      [{ incurredAt: new Date(2026, 8, 5), amountPaise: 50_000, category: 'RENT' }],
    );

    const result = await expensesService.getProfitAndLoss(FROM, TO);

    // April through September inclusive.
    expect(result.monthly).toHaveLength(6);
    expect(result.monthly[0]?.incomePaise).toBe(100_000);
    expect(result.monthly[1]?.incomePaise).toBe(0);
  });

  it('computes net per month', async () => {
    setUp(
      [{ paidAt: new Date(2026, 3, 10), amountPaise: 300_000, refundedPaise: 0 }],
      [{ incurredAt: new Date(2026, 3, 5), amountPaise: 120_000, category: 'RENT' }],
    );

    const result = await expensesService.getProfitAndLoss(FROM, TO);
    expect(result.monthly[0]?.netPaise).toBe(180_000);
  });
});
