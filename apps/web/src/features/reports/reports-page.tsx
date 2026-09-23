import { formatINR, formatINRCompact } from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import {
  Activity,
  FileText,
  IndianRupee,
  TrendingDown,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { AccentSwitcher } from '@/components/common/accent-switcher';
import { DateRangePicker } from '@/components/common/date-range-picker';
import { ErrorState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import {
  MemberGrowthChart,
  PaymentModeChart,
  PlanDistributionChart,
  RevenueTrendChart,
  type DistributionSlice,
  type GrowthPoint,
  type RevenuePoint,
} from '@/features/dashboard/charts';
import {
  PeriodFilter,
  usePeriod,
  type PeriodKey,
} from '@/features/dashboard/period-filter';
import { api, getErrorMessage } from '@/lib/api-client';
import { openPdf } from '@/lib/open-pdf';
import { isDemoMode } from '@/lib/demo-mode';
import { cn } from '@/lib/utils';

interface ReportsData {
  overview: {
    members: { total: number; active: number; expired: number };
    revenue: {
      thisMonthPaise: number;
      collectedPaise: number;
      pendingPaise: number;
    };
    retention: { churnRatePercent: number; retentionRatePercent: number };
  };
  revenueTrend: RevenuePoint[];
  memberGrowth: GrowthPoint[];
  planDistribution: DistributionSlice[];
  paymentModes: DistributionSlice[];
}

/** The period-scoped half of the page — what the filter actually drives. */
interface PeriodFigures {
  period: { key: PeriodKey; label: string };
  collected: { currentPaise: number; previousPaise: number; count: number };
  newMembers: { current: number; previous: number };
  renewals: { current: number; previous: number };
  outstanding: { totalPaise: number; memberCount: number };
}

/**
 * Reports.
 *
 * Deliberately a different view of the same data the dashboard shows, not a
 * second dashboard: no live feeds, no action widgets. This is the screen an
 * owner opens to understand the business, and the one they export from when
 * their accountant asks.
 */
export function ReportsPage() {
  // A separate storage key from the dashboard's: the period an owner reads
  // reports at ("this year", for the accountant) is rarely the one they watch
  // the floor at ("today"), and sharing the key would fight them.
  const { period, setPeriod, range, setRange } = usePeriod('year', 'azf-report-period');
  const [reportLoading, setReportLoading] = React.useState(false);

  // The charts follow the filter too. Scoped server-side rather than sliced
  // here: the client only holds the buckets it was sent, and re-bucketing a
  // 12-month series into days is not something the browser can invent.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', period, range?.from ?? '', range?.to ?? ''],
    queryFn: async () => {
      const response = await api.get<{ data: ReportsData }>('/dashboard', {
        params: {
          period,
          ...(period === 'custom' && range
            ? { from: range.from, to: range.to }
            : {}),
        },
      });
      return response.data.data;
    },
    enabled: period !== 'custom' || Boolean(range?.from && range?.to),
  });

  // The period-scoped figures. Separate from the request above because the
  // charts below are all-time history and must NOT be refetched when the
  // period changes — only the headline figures move.
  const { data: figures, isLoading: figuresLoading } = useQuery({
    queryKey: ['analytics', period, range?.from ?? '', range?.to ?? ''],
    queryFn: async () => {
      const response = await api.get<{ data: PeriodFigures }>(
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
    enabled: period !== 'custom' || Boolean(range?.from && range?.to),
  });

  /**
   * Open the report PDF.
   *
   * Opened in a new tab rather than downloaded: the owner almost always wants
   * to look before deciding whether to print it or send it on, and a silent
   * download into a Downloads folder is easy to lose.
   */
  async function openReport() {
    if (isDemoMode) {
      toast.info('The PDF report needs the API running', {
        description:
          'Connect a database and start the server to generate it.',
      });
      return;
    }

    // The PDF matches what is on screen. Hardcoding a period here would hand
    // the accountant a different set of numbers from the ones the owner was
    // looking at when they clicked.
    const params = new URLSearchParams({ period });
    if (period === 'custom' && range) {
      params.set('from', range.from);
      params.set('to', range.to);
    }

    setReportLoading(true);
    try {
      // Through openPdf, not window.open: a new tab carries no auth header
      // and the route answers 401. See the note in lib/open-pdf.ts.
      await openPdf(`/dashboard/report.pdf?${params.toString()}`);
      toast.success('Report opened in a new tab');
    } catch (error) {
      toast.error('Could not generate the report', {
        description: getErrorMessage(error),
      });
    } finally {
      setReportLoading(false);
    }
  }

  // Chart subtitles state the window they are actually showing. A hardcoded
  // "last 90 days" under data that now follows the filter is a caption that
  // lies about its own chart.
  // 'today' and a short week widen to 14 days on the server so the chart has
  // a shape to read; the caption says so rather than mislabelling the window.
  const chartsWidened = period === 'today' || period === 'week';
  // The server buckets by day for short windows; the title must not claim
  // months when the bars are days.
  const bucketUnit =
    data && data.revenueTrend.length > 0 && /\d/.test(data.revenueTrend[0]!.month)
      ? 'day'
      : 'month';
  const scopeLabel = figures
    ? period === 'all'
      ? 'over the last 12 months'
      : chartsWidened
        ? 'over the last 14 days'
        : figures.period.label
    : '';

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const overview = data?.overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
            Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Business performance at a glance
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <AccentSwitcher />
          <Button
            size="sm"
            onClick={() => void openReport()}
            disabled={!data || reportLoading}
          >
            <FileText />
            {reportLoading ? 'Generating…' : 'Download report'}
          </Button>
        </div>
      </div>

      {/* Period filter. Drives the headline figures and the PDF; the charts
          below are all-time history and stay put. */}
      <div className="flex flex-wrap items-center gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <DateRangePicker
          value={period === 'custom' ? range : null}
          onChange={setRange}
          onClear={() => setRange(null)}
        />
      </div>

      {/* Headline figures — period-scoped, so the label says which period. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          icon={IndianRupee}
          label={`Collected · ${figures?.period.label ?? ''}`}
          value={
            figures
              ? formatINRCompact(figures.collected.currentPaise)
              : undefined
          }
          hint={
            figures
              ? `${figures.collected.count} payment${figures.collected.count === 1 ? '' : 's'}`
              : undefined
          }
          loading={figuresLoading}
        />
        <Metric
          icon={Users}
          label="New members"
          value={figures ? String(figures.newMembers.current) : undefined}
          hint={
            figures ? `${figures.newMembers.previous} previously` : undefined
          }
          loading={figuresLoading}
        />
        <Metric
          icon={Activity}
          label="Renewals"
          value={figures ? String(figures.renewals.current) : undefined}
          hint={figures ? `${figures.renewals.previous} previously` : undefined}
          tone="success"
          loading={figuresLoading}
        />
        <Metric
          icon={TrendingDown}
          label="Outstanding dues"
          value={
            figures
              ? formatINRCompact(figures.outstanding.totalPaise)
              : undefined
          }
          hint={
            figures ? `${figures.outstanding.memberCount} members` : undefined
          }
          tone="destructive"
          loading={figuresLoading}
        />
      </div>

      {/* Business totals — NOT period-scoped. Separated from the row above
          so a period filter never looks like it is filtering them. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          icon={Users}
          label="Total members"
          value={overview ? String(overview.members.total) : undefined}
          hint="all time"
        />
        <Metric
          icon={Activity}
          label="Active"
          value={overview ? String(overview.members.active) : undefined}
          hint="right now"
          tone="success"
        />
        <Metric
          icon={TrendingDown}
          label="Churn rate"
          value={
            overview ? `${overview.retention.churnRatePercent}%` : undefined
          }
          hint="all time"
          tone="destructive"
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ReportCard
          className="lg:col-span-2"
          title={`Revenue by ${bucketUnit}`}
          description={`Collections${scopeLabel ? ` · ${scopeLabel}` : ''}, with the trend and average marked`}
          loading={isLoading}
        >
          {data && <RevenueTrendChart data={data.revenueTrend} />}
        </ReportCard>

        <ReportCard
          title="Plan mix"
          description="Active memberships, most popular first"
          loading={isLoading}
        >
          {data && data.planDistribution.length > 0 && (
            <PlanDistributionChart data={data.planDistribution} />
          )}
        </ReportCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReportCard
          className="lg:col-span-2"
          title="Net member change"
          description={`Above the line the gym grew; below it shrank${scopeLabel ? ` · ${scopeLabel}` : ''}`}
          loading={isLoading}
        >
          {data && <MemberGrowthChart data={data.memberGrowth} />}
        </ReportCard>

        <ReportCard
          title="How members pay"
          description={`Collections${scopeLabel ? ` · ${scopeLabel}` : ''}`}
          loading={isLoading}
        >
          {data && data.paymentModes.length > 0 && (
            <PaymentModeChart data={data.paymentModes} />
          )}
        </ReportCard>
      </div>

      {/* Money summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Collections summary</CardTitle>
          <CardDescription>
            What has been billed, collected and is still outstanding
          </CardDescription>
        </CardHeader>

        <CardContent>
          {isLoading || !overview ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <dl className="space-y-2.5 text-sm">
              <SummaryRow
                label="Collected, all time"
                value={formatINR(overview.revenue.collectedPaise, {
                  showDecimals: false,
                })}
                tone="success"
              />
              <SummaryRow
                label="Collected this month"
                value={formatINR(overview.revenue.thisMonthPaise, {
                  showDecimals: false,
                })}
              />
              <Separator className="!my-3" />
              <SummaryRow
                label="Outstanding dues"
                value={formatINR(overview.revenue.pendingPaise, {
                  showDecimals: false,
                })}
                tone="destructive"
                emphasis
              />
            </dl>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <FileText className="size-3.5" />
        The report is a print-ready PDF with charts and tables — suitable for
        an accountant, a bank, or your own records.
      </p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
  /** Secondary line: a comparison, a count, or the scope of the figure. */
  hint?: string;
  tone?: 'default' | 'success' | 'destructive';
  loading?: boolean;
}) {
  const toneStyles = {
    default: 'text-foreground',
    success: 'text-success',
    destructive: 'text-destructive',
  } as const;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <p className="text-[12px] text-muted-foreground">{label}</p>
      </div>
      {value !== undefined && !loading ? (
        <>
          <p
            className={cn(
              'tabular mt-2 font-display text-2xl font-semibold tracking-tight',
              toneStyles[tone],
            )}
          >
            {value}
          </p>
          {hint && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
          )}
        </>
      ) : (
        <>
          <Skeleton className="mt-2.5 h-7 w-20" />
          {hint !== undefined && <Skeleton className="mt-1.5 h-3 w-14" />}
        </>
      )}
    </Card>
  );
}

function ReportCard({
  title,
  description,
  children,
  loading,
  className,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-[280px] w-full" /> : children}
      </CardContent>
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'destructive';
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn(emphasis ? 'font-medium' : 'text-muted-foreground')}>
        {label}
      </dt>
      <dd
        className={cn(
          'tabular',
          emphasis && 'font-semibold',
          tone === 'success' && 'text-success',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
