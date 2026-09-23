import { formatDate, formatINR, formatINRCompact } from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  CopyPlus,
  Plus,
  Receipt,
  Repeat,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ExpenseDialog } from './expense-dialog';

export const EXPENSE_CATEGORIES = [
  'RENT',
  'SALARIES',
  'ELECTRICITY',
  'WATER',
  'EQUIPMENT',
  'MAINTENANCE',
  'MARKETING',
  'SUPPLIES',
  'INTERNET',
  'INSURANCE',
  'TAXES',
  'OTHER',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RENT: 'Rent',
  SALARIES: 'Salaries',
  ELECTRICITY: 'Electricity',
  WATER: 'Water',
  EQUIPMENT: 'Equipment',
  MAINTENANCE: 'Maintenance',
  MARKETING: 'Marketing',
  SUPPLIES: 'Supplies',
  INTERNET: 'Internet',
  INSURANCE: 'Insurance',
  TAXES: 'Taxes',
  OTHER: 'Other',
};

export interface ExpenseRow {
  id: string;
  category: ExpenseCategory;
  title: string;
  notes: string | null;
  amountPaise: number;
  incurredAt: string;
  paymentMode: string;
  paidTo: string | null;
  isRecurring: boolean;
}

interface ProfitAndLoss {
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
  marginPercent: number | null;
  byCategory: Array<{
    category: ExpenseCategory;
    amountPaise: number;
    count: number;
    sharePercent: number;
  }>;
  monthly: Array<{
    month: string;
    incomePaise: number;
    expensePaise: number;
    netPaise: number;
  }>;
}

/**
 * Expenses and profit & loss.
 *
 * The gym already tracks what comes in. Without what goes out, "are we
 * profitable?" is unanswerable — which is the question that actually decides
 * whether to hire a trainer or buy equipment.
 *
 * Income here is what was COLLECTED, not billed. A gym with ₹2L invoiced and
 * ₹1.2L in the bank is not a ₹2L business, and reporting it that way is how
 * small businesses talk themselves into a cash crisis.
 */
export function ExpensesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ExpenseRow | null>(null);
  const [category, setCategory] = React.useState('');

  const pnl = useQuery({
    queryKey: ['profit-loss'],
    queryFn: async () => {
      const response = await api.get<{ data: ProfitAndLoss }>(
        '/expenses/profit-loss',
      );
      return response.data.data;
    },
  });

  const expenses = useQuery({
    queryKey: ['expenses', category],
    queryFn: async () => {
      const response = await api.get<{ data: ExpenseRow[] }>('/expenses', {
        params: { limit: 50, ...(category ? { category } : {}) },
      });
      return response.data.data;
    },
  });

  const rollForward = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        data: { created: number; skipped: number };
      }>('/expenses/roll-forward');
      return response.data.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-loss'] });

      if (result.created === 0) {
        toast.info('Nothing to copy', {
          description:
            result.skipped > 0
              ? 'This month already has its recurring costs.'
              : 'No recurring expenses were found last month.',
        });
      } else {
        toast.success(`${result.created} recurring expenses added`);
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  function openDialog(expense: ExpenseRow | null) {
    setEditing(expense);
    setDialogOpen(true);
  }

  const data = pnl.data;
  const isProfitable = (data?.netPaise ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
            Expenses
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            What the gym spends, and what it keeps
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => rollForward.mutate()}
            loading={rollForward.isPending}
            title="Copy last month's rent, salaries and other fixed costs"
          >
            <CopyPlus />
            Copy recurring
          </Button>

          <Button size="sm" onClick={() => openDialog(null)}>
            <Plus />
            Add expense
          </Button>
        </div>
      </div>

      {/* ── P&L headline ─────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PnlCard
          label="Income"
          value={data ? formatINRCompact(data.incomePaise) : undefined}
          icon={TrendingUp}
          tone="success"
          sub="Collected, net of refunds"
        />
        <PnlCard
          label="Expenses"
          value={data ? formatINRCompact(data.expensePaise) : undefined}
          icon={TrendingDown}
          tone="destructive"
          sub="This financial year"
        />
        <PnlCard
          label={isProfitable ? 'Net profit' : 'Net loss'}
          value={data ? formatINRCompact(Math.abs(data.netPaise)) : undefined}
          icon={isProfitable ? ArrowUpRight : ArrowDownRight}
          tone={isProfitable ? 'success' : 'destructive'}
          sub={isProfitable ? 'Income exceeds costs' : 'Costs exceed income'}
          emphasis
        />
        <PnlCard
          label="Margin"
          value={
            data
              ? data.marginPercent === null
                ? '—'
                : `${data.marginPercent}%`
              : undefined
          }
          icon={Wallet}
          tone={isProfitable ? 'success' : 'destructive'}
          sub={
            data?.marginPercent === null
              ? 'No income recorded yet'
              : 'Of every rupee collected'
          }
        />
      </div>

      {/* ── Where the money goes ─────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              Income vs expenses
            </h3>

            {pnl.isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : !data || data.monthly.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No data yet"
                description="Record expenses to see the monthly picture."
                className="py-10"
              />
            ) : (
              <MonthlyBars months={data.monthly} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              Cost breakdown
            </h3>

            {pnl.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : !data || data.byCategory.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No expenses"
                description="Add your first expense to see where money goes."
                className="py-8"
              />
            ) : (
              <div className="space-y-3">
                {data.byCategory.slice(0, 7).map((row) => (
                  <div key={row.category}>
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-muted-foreground">
                        {CATEGORY_LABELS[row.category]}
                      </span>
                      <span className="tabular font-medium">
                        {formatINRCompact(row.amountPaise)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${row.sharePercent}%` }}
                        />
                      </span>
                      <span className="tabular w-9 text-right text-[11px] text-muted-foreground">
                        {row.sharePercent}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Expense list ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recent expenses
          </h3>

          <Select
            value={category || 'all'}
            onValueChange={(value) =>
              setCategory(value === 'all' ? '' : value)
            }
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {EXPENSE_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {expenses.error ? (
          <ErrorState
            error={expenses.error}
            onRetry={() => void expenses.refetch()}
          />
        ) : expenses.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 p-4">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        ) : !expenses.data || expenses.data.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={category ? 'None in this category' : 'No expenses recorded'}
            description="Track rent, salaries, electricity and everything else the gym pays for."
            action={
              <Button onClick={() => openDialog(null)}>
                <Plus />
                Add expense
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {expenses.data.map((expense, index) => (
              <motion.button
                key={expense.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(index * 0.02, 0.2) }}
                onClick={() => openDialog(expense)}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/40"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                  <Receipt className="size-4 text-destructive" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {expense.title}
                    </span>
                    <Badge variant="secondary" size="sm">
                      {CATEGORY_LABELS[expense.category]}
                    </Badge>
                    {expense.isRecurring && (
                      <Badge variant="info" size="sm">
                        <Repeat className="size-2.5" />
                        Monthly
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatDate(expense.incurredAt)}
                    {expense.paidTo && ` · ${expense.paidTo}`}
                  </div>
                </div>

                <span className="tabular shrink-0 font-semibold text-destructive">
                  −{formatINR(expense.amountPaise, { showDecimals: false })}
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </Card>

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
      />
    </div>
  );
}

/**
 * Income vs expense bars, drawn inline.
 *
 * Both series share one scale so the gap between them IS the profit — which
 * is the only thing an owner is looking for on this chart.
 */
function MonthlyBars({
  months,
}: {
  months: ProfitAndLoss['monthly'];
}) {
  const max = Math.max(
    ...months.flatMap((m) => [m.incomePaise, m.expensePaise]),
    1,
  );

  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {months.map((month) => (
          <div key={month.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              <span
                className="w-1/2 rounded-t bg-success/80 transition-all"
                style={{
                  height: `${Math.max(2, (month.incomePaise / max) * 100)}%`,
                }}
                title={`Income ${formatINRCompact(month.incomePaise)}`}
              />
              <span
                className="w-1/2 rounded-t bg-destructive/70 transition-all"
                style={{
                  height: `${Math.max(2, (month.expensePaise / max) * 100)}%`,
                }}
                title={`Expenses ${formatINRCompact(month.expensePaise)}`}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {month.month}
            </span>
          </div>
        ))}
      </div>

      <Separator className="my-3" />

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success/80" />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-destructive/70" />
          Expenses
        </span>
      </div>
    </div>
  );
}

function PnlCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  emphasis,
}: {
  label: string;
  value?: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'success' | 'destructive';
  emphasis?: boolean;
}) {
  return (
    <Card className={cn('p-5', emphasis && 'ring-1 ring-primary/30')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted-foreground">{label}</p>

          {value === undefined ? (
            <Skeleton className="mt-2 h-8 w-24" />
          ) : (
            <p
              className={cn(
                'tabular mt-1.5 font-display font-semibold leading-none tracking-tight',
                emphasis ? 'text-[28px]' : 'text-[24px]',
                tone === 'success' ? 'text-success' : 'text-destructive',
              )}
            >
              {value}
            </p>
          )}

          <p className="mt-2 text-[11px] text-muted-foreground">{sub}</p>
        </div>

        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            tone === 'success'
              ? 'bg-success/10 text-success'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </Card>
  );
}
