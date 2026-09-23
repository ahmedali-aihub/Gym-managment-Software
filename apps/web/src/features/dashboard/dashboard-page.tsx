import {
  formatINR,
  formatINRCompact,
  formatTime,
  relativeExpiry,
  type MemberStatus,
} from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  MessageSquare,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AccentSwitcher } from '@/components/common/accent-switcher';
import { DateRangePicker } from '@/components/common/date-range-picker';
import { EmptyState, ErrorState } from '@/components/common/states';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { timeAgo } from '@/lib/utils';
import {
  MemberGrowthChart,
  PaymentModeChart,
  PeakHoursHeatmap,
  PlanDistributionChart,
  RevenueTrendChart,
  type DistributionSlice,
  type GrowthPoint,
  type HeatmapCell,
  type RevenuePoint,
} from './charts';
import { RenewalReminderDialog } from '@/features/members/renewal-reminder-dialog';
import { AnalyticsPanel, TodayCollectionCard } from './analytics-panel';
import { KpiCard } from './kpi-card';
import { PeriodFilter, usePeriod } from './period-filter';

interface DashboardData {
  overview: {
    members: {
      total: number;
      active: number;
      expired: number;
      frozen: number;
      expiringSoon: number;
    };
    joins: { thisMonth: number; lastMonth: number };
    revenue: {
      thisMonthPaise: number;
      lastMonthPaise: number;
      collectedPaise: number;
      pendingPaise: number;
    };
    retention: { churnRatePercent: number; retentionRatePercent: number };
  };
  revenueTrend: RevenuePoint[];
  memberGrowth: GrowthPoint[];
  planDistribution: DistributionSlice[];
  paymentModes: DistributionSlice[];
  peakHours: HeatmapCell[];
  recentCheckIns: Array<{
    id: string;
    checkInAt: string;
    member: {
      id: string;
      memberId: string;
      fullName: string;
      photoUrl: string | null;
    };
  }>;
  expiring: Array<{
    id: string;
    endDate: string;
    member: {
      id: string;
      memberId: string;
      fullName: string;
      phone: string;
      photoUrl: string | null;
    };
    plan: { name: string };
  }>;
  defaulters: Array<{
    id: string;
    memberId: string;
    fullName: string;
    phone: string;
    photoUrl: string | null;
    balanceDuePaise: number;
  }>;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { period, setPeriod, range, setRange } = usePeriod('month');
  const [remindersOpen, setRemindersOpen] = React.useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await api.get<{ data: DashboardData }>('/dashboard');
      return response.data.data;
    },
    // The check-in feed and expiry counts go stale quickly during opening
    // hours; a minute keeps them current without hammering the API.
    refetchInterval: 60_000,
  });

  if (error && !data) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const overview = data?.overview;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>

        <Button onClick={() => navigate('/members/new')}>
          <UserPlus />
          New member
        </Button>
      </div>

      {/* Period filter drives the analytics row below it. The custom range
          sits beside it: picking a range switches the period to 'custom',
          and clearing it returns to the month. */}
      <div className="flex flex-wrap items-center gap-3">
        <PeriodFilter value={period} onChange={setPeriod} />
        <DateRangePicker
          value={period === 'custom' ? range : null}
          onChange={setRange}
          onClear={() => setRange(null)}
        />
      </div>

      {/* Period-scoped analytics */}
      <AnalyticsPanel
        period={period}
        range={period === 'custom' ? range : null}
      />

      {/* Today's collection alongside the member-status KPIs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <TodayCollectionCard />

        <div className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-2">

          <KpiCard
            index={0}
            label="Total members"
            value={overview?.members.total ?? 0}
            format={(v) => String(v)}
            icon={Users}
            accent="primary"
            loading={isLoading}
            onClick={() => navigate('/members')}
          />
          <KpiCard
            index={1}
            label="Active members"
            value={overview?.members.active ?? 0}
            format={(v) => String(v)}
            icon={Activity}
            accent="success"
            loading={isLoading}
            onClick={() => navigate('/members?status=ACTIVE')}
          />
          <KpiCard
            index={2}
            label="Expiring in 7 days"
            value={overview?.members.expiringSoon ?? 0}
            format={(v) => String(v)}
            icon={CalendarClock}
            accent="warning"
            loading={isLoading}
            onClick={() => navigate('/members?expiringInDays=7')}
          />
          <KpiCard
            index={3}
            label="Expired members"
            value={overview?.members.expired ?? 0}
            format={(v) => String(v)}
            icon={AlertTriangle}
            accent="destructive"
            loading={isLoading}
            onClick={() => navigate('/members?status=EXPIRED')}
          />
        </div>
      </div>

      {/* ── Charts ──────────────────────────────────────────────────── */}
      {/* The accent switcher sits immediately above the charts it recolours,
          so the control and its effect are in view together. */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Trends
        </h2>
        <AccentSwitcher />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Revenue by month"
          description="Collections per month with the trend and average marked"
          loading={isLoading}
        >
          {data && <RevenueTrendChart data={data.revenueTrend} />}
        </ChartCard>

        <ChartCard
          title="Plan mix"
          description="Active memberships, most popular first"
          loading={isLoading}
        >
          {data &&
            (data.planDistribution.length > 0 ? (
              <PlanDistributionChart data={data.planDistribution} />
            ) : (
              <EmptyState
                title="No active memberships"
                description="Plan distribution appears once members are registered."
              />
            ))}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Net member change"
          description="Above the line the gym grew; below it shrank"
          loading={isLoading}
        >
          {data && <MemberGrowthChart data={data.memberGrowth} />}
        </ChartCard>

        <ChartCard
          title="How members pay"
          description="Collections in the last 90 days"
          loading={isLoading}
        >
          {data &&
            (data.paymentModes.length > 0 ? (
              <PaymentModeChart data={data.paymentModes} />
            ) : (
              <EmptyState
                title="No payments yet"
                description="The split by method appears after the first payment."
              />
            ))}
        </ChartCard>
      </div>

      <ChartCard
        title="When the gym is busy"
        description="Check-ins by day and hour, last 90 days"
        loading={isLoading}
      >
        {data && <PeakHoursHeatmap data={data.peakHours} />}
      </ChartCard>

      {/* ── Widgets ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <ExpiringWidget
          items={data?.expiring}
          loading={isLoading}
          onSendReminders={() => setRemindersOpen(true)}
        />
        <DefaultersWidget items={data?.defaulters} loading={isLoading} />
        <CheckInFeed items={data?.recentCheckIns} loading={isLoading} />
      </div>

      <RenewalReminderDialog
        open={remindersOpen}
        onOpenChange={setRemindersOpen}
      />
    </div>
  );
}

function ChartCard({
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
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-[280px] w-full" /> : children}
      </CardContent>
    </Card>
  );
}

function ExpiringWidget({
  items,
  loading,
  onSendReminders,
}: {
  items?: DashboardData['expiring'];
  loading?: boolean;
  onSendReminders: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Expiring this week</CardTitle>
          <CardDescription>Renew before they lapse</CardDescription>
        </div>
        <Badge variant="warning">{items?.length ?? 0}</Badge>
      </CardHeader>

      <CardContent className="space-y-1">
        {loading ? (
          <RowSkeletons />
        ) : !items || items.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nothing expiring"
            description="No memberships lapse in the next 7 days."
            className="py-8"
          />
        ) : (
          <>
            {items.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                to={`/members/${item.member.id}`}
                className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
              >
                <MemberAvatar
                  name={item.member.fullName}
                  photoUrl={item.member.photoUrl}
                  className="size-9"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {item.member.fullName}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.plan.name}
                  </div>
                </div>
                <Badge variant="warning" size="sm">
                  {relativeExpiry(item.endDate).replace('Expires ', '')}
                </Badge>
              </Link>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={onSendReminders}
            >
              <MessageSquare />
              Send renewal reminders
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DefaultersWidget({
  items,
  loading,
}: {
  items?: DashboardData['defaulters'];
  loading?: boolean;
}) {
  const total = items?.reduce((sum, m) => sum + m.balanceDuePaise, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Top defaulters</CardTitle>
          <CardDescription>Largest outstanding balances</CardDescription>
        </div>
        {total > 0 && (
          <Badge variant="destructive" className="tabular">
            {formatINRCompact(total)}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-1">
        {loading ? (
          <RowSkeletons />
        ) : !items || items.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No dues outstanding"
            description="Every member is fully paid up."
            className="py-8"
          />
        ) : (
          <>
            {items.map((member) => (
              <Link
                key={member.id}
                to={`/members/${member.id}`}
                className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
              >
                <MemberAvatar
                  name={member.fullName}
                  photoUrl={member.photoUrl}
                  className="size-9"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {member.fullName}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {member.memberId}
                  </div>
                </div>
                <span className="tabular text-sm font-semibold text-destructive">
                  {formatINR(member.balanceDuePaise, { showDecimals: false })}
                </span>
              </Link>
            ))}

            <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
              <Link to="/members?hasDues=true">
                View all
                <ArrowRight />
              </Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CheckInFeed({
  items,
  loading,
}: {
  items?: DashboardData['recentCheckIns'];
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Live check-ins</CardTitle>
          <CardDescription>Most recent arrivals</CardDescription>
        </div>
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-success" />
          <span className="relative inline-flex size-2.5 rounded-full bg-success" />
        </span>
      </CardHeader>

      <CardContent className="space-y-1">
        {loading ? (
          <RowSkeletons />
        ) : !items || items.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No check-ins yet"
            description="Arrivals appear here as members scan in."
            className="py-8"
          />
        ) : (
          <AnimatePresence initial={false}>
            {items.slice(0, 6).map((entry) => (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <Link
                  to={`/members/${entry.member.id}`}
                  className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
                >
                  <MemberAvatar
                    name={entry.member.fullName}
                    photoUrl={entry.member.photoUrl}
                    className="size-9"
                    showStatus
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {entry.member.fullName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {formatTime(entry.checkInAt)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(entry.checkInAt)}
                  </span>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </CardContent>
    </Card>
  );
}

function RowSkeletons() {
  return (
    <div className="space-y-3 py-1">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export type { MemberStatus };
