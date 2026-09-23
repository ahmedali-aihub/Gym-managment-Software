import {
  PAYMENT_MODE_LABELS,
  formatDate,
  formatDateTime,
  formatINR,
  formatINRCompact,
  type PaymentMode,
} from '@azf/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Receipt,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/common/states';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface PaymentRow {
  id: string;
  amountPaise: number;
  mode: PaymentMode;
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

interface PaymentStats {
  collectedPaise: number;
  pendingPaise: number;
  refundedPaise: number;
  transactionCount: number;
  byMode: Record<PaymentMode, { count: number; amountPaise: number }>;
}

const MODE_VARIANTS: Record<PaymentMode, 'success' | 'info' | 'default' | 'secondary'> = {
  CASH: 'success',
  UPI: 'info',
  CARD: 'default',
  NET_BANKING: 'secondary',
  ONLINE: 'info',
};

/**
 * Payments ledger.
 *
 * Filter state lives in the URL so a view is shareable — "UPI payments this
 * month" can be sent as a link rather than described.
 */
export function PaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get('page')) || 1;
  const mode = searchParams.get('mode') ?? '';
  const urlSearch = searchParams.get('search') ?? '';

  const [searchInput, setSearchInput] = React.useState(urlSearch);

  React.useEffect(() => setSearchInput(urlSearch), [urlSearch]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput === urlSearch) return;
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (searchInput) next.set('search', searchInput);
          else next.delete('search');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, urlSearch, setSearchParams]);

  function updateFilter(key: string, value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('page');
      return next;
    });
  }

  const { data: stats } = useQuery({
    queryKey: ['payment-stats'],
    queryFn: async () => {
      const response = await api.get<{ data: PaymentStats }>('/payments/stats');
      return response.data.data;
    },
  });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['payments', { page, mode, urlSearch }],
    queryFn: async () => {
      const response = await api.get<{
        data: PaymentRow[];
        meta: {
          page: number;
          totalPages: number;
          total: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>('/payments', {
        params: {
          page,
          limit: 20,
          ...(mode ? { mode } : {}),
          ...(urlSearch ? { search: urlSearch } : {}),
        },
      });
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  /**
   * Export the current view to CSV.
   *
   * Exports what is on screen, filters included — an accountant asking for
   * "UPI payments in September" gets exactly that, not the whole ledger.
   *
   * The BOM matters: without it Excel on Windows reads UTF-8 as the system
   * codepage and mangles every non-ASCII name.
   */
  function exportCsv() {
    if (!data?.data.length) return;

    const rows = [
      ['Date', 'Member ID', 'Member', 'Phone', 'Mode', 'Reference', 'Amount (INR)', 'Receipt'],
      ...data.data.map((payment) => [
        formatDate(payment.paidAt),
        payment.member.memberId,
        payment.member.fullName,
        payment.member.phone,
        PAYMENT_MODE_LABELS[payment.mode],
        payment.reference ?? '',
        String(payment.amountPaise / 100),
        payment.invoice?.invoiceNumber ?? '',
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          // Quote any cell containing a comma, quote or newline, escaping
          // embedded quotes by doubling them — the RFC 4180 rule.
          .map((cell) =>
            /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
          )
          .join(','),
      )
      .join('\n');

    const blob = new Blob(['﻿' + csv], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `azf-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success(`${data.data.length} payments exported`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
            Payments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.meta.total ?? 0} transaction
            {data?.meta.total === 1 ? '' : 's'}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={!data?.data.length}
        >
          <Download />
          Export
        </Button>
      </div>

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Collected"
          value={stats ? formatINRCompact(stats.collectedPaise) : undefined}
          tone="success"
        />
        <SummaryCard
          label="Pending dues"
          value={stats ? formatINRCompact(stats.pendingPaise) : undefined}
          tone="destructive"
        />
        <SummaryCard
          label="Transactions"
          value={stats ? String(stats.transactionCount) : undefined}
        />
      </div>

      {/* Toolbar */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by member, ID or reference…"
            icon={<Search />}
            className="min-w-[220px] flex-1"
            suffix={
              searchInput ? (
                <button
                  onClick={() => setSearchInput('')}
                  className="pointer-events-auto rounded p-0.5 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X />
                </button>
              ) : undefined
            }
          />

          <Select
            value={mode || 'all'}
            onValueChange={(value) =>
              updateFilter('mode', value === 'all' ? '' : value)
            }
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All methods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              {Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Ledger */}
      <Card className="overflow-hidden">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LedgerSkeleton />
        ) : !data || data.data.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={mode || urlSearch ? 'No matching payments' : 'No payments yet'}
            description={
              mode || urlSearch
                ? 'Try adjusting your filters.'
                : 'Payments appear here as they are collected at the desk.'
            }
          />
        ) : (
          <>
            <div
              className={cn(
                'divide-y divide-border',
                isFetching && 'opacity-60 transition-opacity',
              )}
            >
              {data.data.map((payment, index) => (
                <motion.div
                  key={payment.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(index * 0.02, 0.2) }}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/40 sm:px-5"
                >
                  <MemberAvatar
                    name={payment.member.fullName}
                    className="size-9"
                  />

                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/members/${payment.member.id}`}
                      className="truncate text-sm font-medium hover:text-primary hover:underline"
                    >
                      {payment.member.fullName}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">
                      {payment.member.memberId}
                      {payment.reference && ` · ${payment.reference}`}
                    </div>
                  </div>

                  <div className="hidden text-right sm:block">
                    <Badge variant={MODE_VARIANTS[payment.mode]} size="sm">
                      {PAYMENT_MODE_LABELS[payment.mode]}
                    </Badge>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {formatDate(payment.paidAt)}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="tabular font-semibold text-success">
                      {formatINR(payment.amountPaise, { showDecimals: false })}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {data.meta.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Page {data.meta.page} of {data.meta.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!data.meta.hasPreviousPage}
                    onClick={() => updateFilter('page', String(page - 1))}
                  >
                    <ChevronLeft />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!data.meta.hasNextPage}
                    onClick={() => updateFilter('page', String(page + 1))}
                  >
                    Next
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value?: string;
  tone?: 'default' | 'success' | 'destructive';
}) {
  const toneStyles = {
    default: 'text-foreground',
    success: 'text-success',
    destructive: 'text-destructive',
  } as const;

  return (
    <Card className="p-4">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      {value ? (
        <p
          className={cn(
            'tabular mt-1.5 font-display text-2xl font-semibold tracking-tight',
            toneStyles[tone],
          )}
        >
          {value}
        </p>
      ) : (
        <Skeleton className="mt-2 h-7 w-24" />
      )}
    </Card>
  );
}

function LedgerSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

export { Receipt, formatDateTime };
