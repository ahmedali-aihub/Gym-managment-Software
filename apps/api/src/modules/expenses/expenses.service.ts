import type { PaginatedResponse } from '@azf/shared';
import type { Expense, ExpenseCategory, Prisma } from '@prisma/client';
import { NotFoundError } from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import {
  buildOrderBy,
  buildPaginatedResponse,
  getSkipTake,
} from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';

const log = moduleLogger('expenses');

const SORTABLE_FIELDS = [
  'incurredAt',
  'amountPaise',
  'category',
  'createdAt',
] as const;

export interface ExpenseQueryParams {
  page: number;
  limit: number;
  sortBy?: string | undefined;
  sortOrder: 'asc' | 'desc';
  search?: string | undefined;
  category?: ExpenseCategory | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface CreateExpenseInput {
  category: ExpenseCategory;
  title: string;
  notes?: string | undefined;
  amountPaise: number;
  incurredAt: Date;
  paymentMode: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING' | 'ONLINE';
  reference?: string | undefined;
  paidTo?: string | undefined;
  isRecurring: boolean;
}

/**
 * Profit and loss for a period.
 *
 * Income is what was actually COLLECTED, not what was billed. A gym with
 * ₹2L invoiced and ₹1.2L in the bank is not a ₹2L business, and reporting it
 * that way is how small businesses talk themselves into a cash crisis.
 */
export interface ProfitAndLoss {
  from: string;
  to: string;
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
  /** Net as a percentage of income. Null when there was no income. */
  marginPercent: number | null;
  byCategory: Array<{
    category: ExpenseCategory;
    amountPaise: number;
    count: number;
    /** Share of total expenses, 0–100. */
    sharePercent: number;
  }>;
  /** Month-by-month income vs expense, for the chart. */
  monthly: Array<{
    month: string;
    incomePaise: number;
    expensePaise: number;
    netPaise: number;
  }>;
}

class ExpensesService {
  async list(params: ExpenseQueryParams): Promise<PaginatedResponse<Expense>> {
    const { skip, take } = getSkipTake(params);

    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      ...(params.category ? { category: params.category } : {}),
      ...(params.from || params.to
        ? {
            incurredAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { title: { contains: params.search, mode: 'insensitive' } },
              { paidTo: { contains: params.search, mode: 'insensitive' } },
              { notes: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(
          params.sortBy,
          params.sortOrder,
          SORTABLE_FIELDS,
          'incurredAt',
        ),
        include: {
          recordedBy: { select: { id: true, fullName: true } },
        },
      }),
      prisma.expense.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, params);
  }

  async create(
    input: CreateExpenseInput,
    recordedById: string | null,
  ): Promise<Expense> {
    const expense = await prisma.expense.create({
      data: {
        category: input.category,
        title: input.title,
        notes: input.notes ?? null,
        amountPaise: input.amountPaise,
        incurredAt: input.incurredAt,
        paymentMode: input.paymentMode,
        reference: input.reference ?? null,
        paidTo: input.paidTo ?? null,
        isRecurring: input.isRecurring,
        recordedById,
      },
    });

    log.info(
      { expenseId: expense.id, category: expense.category, amountPaise: expense.amountPaise },
      'Expense recorded',
    );

    return expense;
  }

  async update(
    id: string,
    input: Partial<CreateExpenseInput>,
  ): Promise<Expense> {
    await this.getById(id);

    return prisma.expense.update({
      where: { id },
      data: {
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.amountPaise !== undefined
          ? { amountPaise: input.amountPaise }
          : {}),
        ...(input.incurredAt !== undefined
          ? { incurredAt: input.incurredAt }
          : {}),
        ...(input.paymentMode !== undefined
          ? { paymentMode: input.paymentMode }
          : {}),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.paidTo !== undefined ? { paidTo: input.paidTo } : {}),
        ...(input.isRecurring !== undefined
          ? { isRecurring: input.isRecurring }
          : {}),
      },
    });
  }

  async getById(id: string): Promise<Expense> {
    const expense = await prisma.expense.findFirst({
      where: { id, deletedAt: null },
    });
    if (!expense) throw new NotFoundError('Expense');
    return expense;
  }

  /**
   * Soft delete.
   *
   * Expenses feed the P&L, and a hard delete would silently change last
   * month's reported profit after it had already been read.
   */
  async remove(id: string): Promise<void> {
    await this.getById(id);
    await prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    log.info({ expenseId: id }, 'Expense removed');
  }

  /**
   * Copy last month's recurring expenses into this month.
   *
   * Rent and salaries are the same every month, and retyping them is the
   * reason expense tracking gets abandoned. Returns how many were created.
   */
  async rollForwardRecurring(
    targetMonth: Date,
    recordedById: string | null,
  ): Promise<{ created: number; skipped: number }> {
    const monthStart = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth(),
      1,
    );
    const monthEnd = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    const previousStart = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth() - 1,
      1,
    );
    const previousEnd = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth(),
      0,
      23,
      59,
      59,
      999,
    );

    const [templates, existing] = await Promise.all([
      prisma.expense.findMany({
        where: {
          deletedAt: null,
          isRecurring: true,
          incurredAt: { gte: previousStart, lte: previousEnd },
        },
      }),
      prisma.expense.findMany({
        where: {
          deletedAt: null,
          isRecurring: true,
          incurredAt: { gte: monthStart, lte: monthEnd },
        },
        select: { title: true, category: true },
      }),
    ]);

    // Running this twice must not double-charge rent.
    const alreadyThere = new Set(
      existing.map((e) => `${e.category}::${e.title.toLowerCase()}`),
    );

    const toCreate = templates.filter(
      (t) => !alreadyThere.has(`${t.category}::${t.title.toLowerCase()}`),
    );

    if (toCreate.length > 0) {
      await prisma.expense.createMany({
        data: toCreate.map((template) => ({
          category: template.category,
          title: template.title,
          notes: template.notes,
          amountPaise: template.amountPaise,
          // Same day of the month as last time, clamped into range.
          incurredAt: new Date(
            monthStart.getFullYear(),
            monthStart.getMonth(),
            Math.min(
              template.incurredAt.getDate(),
              monthEnd.getDate(),
            ),
          ),
          paymentMode: template.paymentMode,
          paidTo: template.paidTo,
          isRecurring: true,
          recordedById,
        })),
      });
    }

    log.info(
      { created: toCreate.length, skipped: templates.length - toCreate.length },
      'Recurring expenses rolled forward',
    );

    return {
      created: toCreate.length,
      skipped: templates.length - toCreate.length,
    };
  }

  /** Profit and loss across a date range. */
  async getProfitAndLoss(from: Date, to: Date): Promise<ProfitAndLoss> {
    const [income, expenseTotal, byCategory, payments, expenses] =
      await Promise.all([
        prisma.payment.aggregate({
          where: { deletedAt: null, paidAt: { gte: from, lte: to } },
          _sum: { amountPaise: true, refundedPaise: true },
        }),
        prisma.expense.aggregate({
          where: { deletedAt: null, incurredAt: { gte: from, lte: to } },
          _sum: { amountPaise: true },
        }),
        prisma.expense.groupBy({
          by: ['category'],
          where: { deletedAt: null, incurredAt: { gte: from, lte: to } },
          _sum: { amountPaise: true },
          _count: { _all: true },
        }),
        prisma.payment.findMany({
          where: { deletedAt: null, paidAt: { gte: from, lte: to } },
          select: { paidAt: true, amountPaise: true, refundedPaise: true },
        }),
        prisma.expense.findMany({
          where: { deletedAt: null, incurredAt: { gte: from, lte: to } },
          select: { incurredAt: true, amountPaise: true },
        }),
      ]);

    // Refunds are money that left again — netting them off is the difference
    // between reported and actual income.
    const incomePaise =
      (income._sum.amountPaise ?? 0) - (income._sum.refundedPaise ?? 0);
    const expensePaise = expenseTotal._sum.amountPaise ?? 0;
    const netPaise = incomePaise - expensePaise;

    // Month buckets, seeded so a month with no activity still appears.
    const buckets = new Map<
      string,
      { month: string; incomePaise: number; expensePaise: number }
    >();

    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    while (cursor <= to) {
      buckets.set(`${cursor.getFullYear()}-${cursor.getMonth()}`, {
        month: cursor.toLocaleDateString('en-IN', { month: 'short' }),
        incomePaise: 0,
        expensePaise: 0,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    for (const payment of payments) {
      const key = `${payment.paidAt.getFullYear()}-${payment.paidAt.getMonth()}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.incomePaise += payment.amountPaise - payment.refundedPaise;
      }
    }

    for (const expense of expenses) {
      const key = `${expense.incurredAt.getFullYear()}-${expense.incurredAt.getMonth()}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.expensePaise += expense.amountPaise;
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      incomePaise,
      expensePaise,
      netPaise,
      // A margin on zero income is undefined, not zero — the UI shows "—".
      marginPercent:
        incomePaise > 0
          ? Number(((netPaise / incomePaise) * 100).toFixed(1))
          : null,
      byCategory: byCategory
        .map((row) => ({
          category: row.category,
          amountPaise: row._sum.amountPaise ?? 0,
          count: row._count._all,
          sharePercent:
            expensePaise > 0
              ? Number(
                  (((row._sum.amountPaise ?? 0) / expensePaise) * 100).toFixed(1),
                )
              : 0,
        }))
        .sort((a, b) => b.amountPaise - a.amountPaise),
      monthly: [...buckets.values()].map((bucket) => ({
        ...bucket,
        netPaise: bucket.incomePaise - bucket.expensePaise,
      })),
    };
  }
}

export const expensesService = new ExpensesService();
