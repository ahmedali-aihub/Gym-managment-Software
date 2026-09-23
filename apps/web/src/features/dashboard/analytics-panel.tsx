import { formatINR, formatINRCompact, formatTime } from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Minus,
  Smartphone,
  TrendingUp,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/common/states';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { cn, percentChange } from '@/lib/utils';
import type { DateRange } from '@/components/common/date-range-picker';
import type { PeriodKey } from './period-filter';

interface PeriodAnalytics {
  period: { key: PeriodKey; label: string; from: string; to: string };
  collected: { currentPaise: number; previousPaise: number; count: number };
  newMembers: { current: number; previous: number };
  renewals: { current: number; previous: number };
  expiring: { current: number };
  outstanding: { totalPaise: number; memberCount: number };
  byMode: Array<{ mode: string; amountPaise: number; count: number }>;
  daily: Array<{ date: string; amountPaise: number }>;
}

interface TodayCollection {
  totalPaise: number;
  count: number;
  byMode: Array<{ mode: string; amountPaise: number; count: number }>;
  recent: Array<{
    id: string;
    amountPaise: number;
    mode: string;
    paidAt: string;
    member: {
      id: string;
      memberId: string;
      fullName: string;
      photoUrl: string | null;
    };
  }>;
}

const MODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
  NET_BANKING: Wallet,
  ONLINE: Smartphone,
};

const MODE_LABELS: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  NET_BANKING: 'Net Banking',
  ONLINE: 'Online',
};

/**
 * Period analytics.
 *
 * Every figure carries its comparison to the equivalent previous period,
 * because a number alone is not an insight: ₹45,000 collected this month
 * means nothing until you know last month was ₹38,000.
 */
export function AnalyticsPanel({
  period,
  range,
}: {
  period: PeriodKey;
  range?: DateRange | null;
}) {
  const { data, isLoading } = useQuery({
    // The range is part of the key: two different custom windows are two
    // different results and must not share a cache entry.
    queryKey: ['analytics', period, range?.from ?? '', range?.to ?? ''],
    queryFn: async () => {
      const response = await api.get<{ data: PeriodAnalytics }>(
        '/dashboard/analytics',
        {
          params: {
            period,
            ...(period === 'custom' && range
              ? { from: range.from, to: range.to }
              : {}),
          },
        },
      );
      return response.data.data;
    },
    // A custom period without a range would ask the API for a window it
    // cannot resolve; wait until both ends are chosen.
    enabled: period !== 'custom' || Boolean(range?.from && range?.to),
  });

  const collectedChange = data
    ? percentChange(data.collected.currentPaise, data.collected.previousPaise)
    : undefined;

  const joinsChange = data
    ? percentChange(data.newMembers.current, data.newMembers.previous)
    : undefined;

  const renewalsChange = data
    ? percentChange(data.renewals.current, data.renewals.previous)
    : undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <AnalyticCard
        index={0}
        label={`Collected · ${data?.period.label ?? ''}`}
        value={data ? formatINRCompact(data.collected.currentPaise) : undefined}
        sub={
          data
            ? `${data.collected.count} payment${data.collected.count === 1 ? '' : 's'}`
            : undefined
        }
        change={collectedChange}
        icon={TrendingUp}
        accent="success"
        loading={isLoading}
      />

      <AnalyticCard
        index={1}
        label="New members"
        value={data ? String(data.newMembers.current) : undefined}
        sub={data ? `${data.newMembers.previous} previously` : undefined}
        change={joinsChange}
        icon={UserPlus}
        accent="primary"
        loading={isLoading}
      />

      <AnalyticCard
        index={2}
        label="Renewals"
        value={data ? String(data.renewals.current) : undefined}
        sub={data ? `${data.renewals.previous} previously` : undefined}
        change={renewalsChange}
        icon={TrendingUp}
        accent="info"
        loading={isLoading}
      />

      {/* Outstanding is a running total, not period-scoped — it is what the
          gym is owed right now, regardless of the selected window. */}
      <AnalyticCard
        index={3}
        label="Outstanding dues"
        value={data ? formatINRCompact(data.outstanding.totalPaise) : undefined}
        sub={
          data
            ? `${data.outstanding.memberCount} member${data.outstanding.memberCount === 1 ? '' : 's'}`
            : undefined
        }
        icon={Wallet}
        accent="destructive"
        loading={isLoading}
        href="/members?hasDues=true"
      />
    </div>
  );
}

/**
 * Today's collection.
 *
 * This is the figure the front desk reconciles the cash drawer against at
 * closing time, so the mode breakdown matters as much as the total — only
 * the cash line should match what is physically in the drawer.
 */
export function TodayCollectionCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['today-collection'],
    queryFn: async () => {
      const response = await api.get<{ data: TodayCollection }>(
        '/dashboard/today',
      );
      return response.data.data;
    },
    // Money arrives throughout the day; a stale total is worse than useless
    // when someone is counting the drawer against it.
    refetchInterval: 60_000,
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] text-muted-foreground">
              Collected today
            </p>
            {isLoading ? (
              <Skeleton className="mt-2 h-9 w-32" />
            ) : (
              <p className="tabular mt-1.5 font-display text-[32px] font-semibold leading-none tracking-tight text-success">
                {formatINR(data?.totalPaise ?? 0, { showDecimals: false })}
              </p>
            )}
            <p className="mt-2 text-[12px] text-muted-foreground">
              {data?.count ?? 0} payment{data?.count === 1 ? '' : 's'} ·{' '}
              {new Date().toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
              })}
            </p>
          </div>

          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-success/10">
            <Banknote className="size-5 text-success" />
          </div>
        </div>

        {/* Mode breakdown */}
        {data && data.byMode.length > 0 && (
          <>
            <Separator className="my-4" />
            <div className="space-y-2.5">
              {data.byMode.map((row) => {
                const Icon = MODE_ICONS[row.mode] ?? Wallet;
                const share =
                  data.totalPaise > 0
                    ? (row.amountPaise / data.totalPaise) * 100
                    : 0;

                return (
                  <div key={row.mode} className="flex items-center gap-2.5">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-[13px] text-muted-foreground">
                      {MODE_LABELS[row.mode] ?? row.mode}
                    </span>

                    {/* A thin share bar reads faster than a percentage. */}
                    <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-muted sm:block">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${share}%` }}
                      />
                    </span>

                    <span className="tabular w-20 text-right text-[13px] font-medium">
                      {formatINR(row.amountPaise, { showDecimals: false })}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Recent payments */}
        <Separator className="my-4" />
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Latest
        </p>

        {isLoading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-2.5">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        ) : !data || data.recent.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Nothing collected yet"
            description="Payments taken today appear here."
            className="py-6"
          />
        ) : (
          <div className="space-y-0.5">
            {data.recent.slice(0, 5).map((payment) => (
              <Link
                key={payment.id}
                to={`/members/${payment.member.id}`}
                className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-accent"
              >
                <MemberAvatar
                  name={payment.member.fullName}
                  photoUrl={payment.member.photoUrl}
                  className="size-8"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {payment.member.fullName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatTime(payment.paidAt)} ·{' '}
                    {MODE_LABELS[payment.mode] ?? payment.mode}
                  </p>
                </div>
                <span className="tabular shrink-0 text-[13px] font-semibold text-success">
                  +{formatINR(payment.amountPaise, { showDecimals: false })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnalyticCard({
  label,
  value,
  sub,
  change,
  icon: Icon,
  accent,
  loading,
  index,
  href,
}: {
  label: string;
  value?: string;
  sub?: string;
  change?: number | null;
  icon: React.ComponentType<{ className?: string }>;
  accent: 'primary' | 'success' | 'info' | 'destructive';
  loading?: boolean;
  index: number;
  href?: string;
}) {
  const accentStyles = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    info: 'bg-info/10 text-info',
    destructive: 'bg-destructive/10 text-destructive',
  } as const;

  const isPositive = change !== null && change !== undefined && change > 0;
  const isNegative = change !== null && change !== undefined && change < 0;

  // Rising dues are bad news; rising revenue is good.
  const inverted = accent === 'destructive';
  const isGood = inverted ? isNegative : isPositive;

  const body = (
    <Card
      className={cn('p-5', href && 'card-interactive cursor-pointer')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-muted-foreground">{label}</p>

          {loading || value === undefined ? (
            <Skeleton className="mt-2 h-8 w-24" />
          ) : (
            <p className="tabular mt-1.5 font-display text-[26px] font-semibold leading-none tracking-tight">
              {value}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {change !== undefined && change !== null && (
              <span
                className={cn(
                  'tabular inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                  change === 0
                    ? 'bg-muted text-muted-foreground'
                    : isGood
                      ? 'bg-success/12 text-success'
                      : 'bg-destructive/12 text-destructive',
                )}
              >
                {change === 0 ? (
                  <Minus className="size-2.5" />
                ) : isPositive ? (
                  <ArrowUpRight className="size-2.5" />
                ) : (
                  <ArrowDownRight className="size-2.5" />
                )}
                {Math.abs(change).toFixed(0)}%
              </span>
            )}

            {change === null && (
              <Badge variant="secondary" size="sm">
                New
              </Badge>
            )}

            {sub && (
              <span className="truncate text-[11px] text-muted-foreground">
                {sub}
              </span>
            )}
          </div>
        </div>

        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            accentStyles[accent],
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </Card>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
    >
      {href ? <Link to={href}>{body}</Link> : body}
    </motion.div>
  );
}
