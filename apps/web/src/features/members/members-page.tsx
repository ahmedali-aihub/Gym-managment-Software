import {
  FITNESS_GOAL_LABELS,
  MEMBER_STATUS_LABELS,
  MemberStatus,
  Role,
  formatDate,
  formatINR,
  formatPhone,
  relativeExpiry,
  type FitnessGoal,
  type MemberStats,
} from '@azf/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/auth-context';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  MessageSquare,
  Phone,
  Search,
  SlidersHorizontal,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DateRangePicker,
  normaliseRange,
} from '@/components/common/date-range-picker';
import { SegmentedControl } from '@/components/common/segmented-control';
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
import { Separator } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { GoalFilter } from './goal-filter';
import { RenewalReminderDialog } from './renewal-reminder-dialog';
import { cn } from '@/lib/utils';

interface MemberRow {
  id: string;
  memberId: string;
  fullName: string;
  phone: string;
  email: string | null;
  photoUrl: string | null;
  status: MemberStatus;
  joinedAt: string;
  goals: FitnessGoal[];
  balanceDuePaise: number;
  totalPaidPaise: number;
  totalBilledPaise: number;
  memberships: Array<{
    id: string;
    startDate: string;
    endDate: string;
    plan: { name: string };
  }>;
}

const STATUS_VARIANTS: Record<
  MemberStatus,
  'success' | 'destructive' | 'info' | 'secondary'
> = {
  ACTIVE: 'success',
  EXPIRED: 'destructive',
  FROZEN: 'info',
  CANCELLED: 'secondary',
};

/**
 * Member list.
 *
 * Filter state lives in the URL, not component state. That makes every view
 * shareable and bookmarkable — a manager can send "the expired members with
 * dues" as a link — and it means the browser back button behaves the way
 * people expect after drilling into a profile.
 */
export function MembersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasRole } = useAuth();
  const canImport = hasRole(Role.OWNER, Role.MANAGER);
  const navigate = useNavigate();

  const page = Number(searchParams.get('page')) || 1;
  const status = searchParams.get('status') ?? '';
  const expiringInDays = searchParams.get('expiringInDays') ?? '';
  const hasDues = searchParams.get('hasDues') ?? '';
  const urlSearch = searchParams.get('search') ?? '';
  const goalsParam = searchParams.get('goals') ?? '';
  // The date range lives in the URL like every other filter, so a filtered
  // list stays shareable and survives a reload.
  // Validated, not trusted: the URL is user-editable, so a malformed date
  // disables the filter rather than silently showing every member under a
  // chip that claims a range is applied. A reversed range is swapped.
  const dateRange = normaliseRange(
    searchParams.get('dateFrom'),
    searchParams.get('dateTo'),
  );
  const dateFrom = dateRange?.from ?? '';
  const dateTo = dateRange?.to ?? '';
  // Which date the range applies to. 'joined' answers "who did we sign up?",
  // 'expiring' answers "who do I need to chase?".
  const dateMode =
    searchParams.get('dateMode') === 'expiring' ? 'expiring' : 'joined';
  const selectedGoals = goalsParam
    ? (goalsParam.split(',').filter(Boolean) as FitnessGoal[])
    : [];

  // Local mirror so typing stays responsive while the URL updates on a delay.
  const [searchInput, setSearchInput] = React.useState(urlSearch);
  const [remindersOpen, setRemindersOpen] = React.useState(false);

  React.useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput === urlSearch) return;

      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (searchInput) next.set('search', searchInput);
          else next.delete('search');
          // A new search invalidates the current page number.
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

  function updateDateRange(range: { from: string; to: string } | null) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (range) {
        next.set('dateFrom', range.from);
        next.set('dateTo', range.to);
        next.set('dateMode', dateMode);
      } else {
        next.delete('dateFrom');
        next.delete('dateTo');
        next.delete('dateMode');
      }
      next.delete('page');
      return next;
    });
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams());
    setSearchInput('');
  }

  const activeFilterCount = [
    status,
    expiringInDays,
    hasDues,
    goalsParam,
    dateFrom && dateTo ? 'range' : '',
  ].filter(Boolean).length;

  const { data: stats } = useQuery({
    queryKey: ['member-stats'],
    queryFn: async () => {
      const response = await api.get<{ data: MemberStats }>('/members/stats');
      return response.data.data;
    },
  });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [
      'members',
      {
        page,
        status,
        expiringInDays,
        hasDues,
        urlSearch,
        goalsParam,
        dateFrom,
        dateTo,
        dateMode,
      },
    ],
    queryFn: async () => {
      const response = await api.get<{
        data: MemberRow[];
        meta: {
          page: number;
          totalPages: number;
          total: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      }>('/members', {
        params: {
          page,
          limit: 20,
          ...(status ? { status } : {}),
          ...(expiringInDays ? { expiringInDays } : {}),
          ...(hasDues ? { hasDues } : {}),
          ...(urlSearch ? { search: urlSearch } : {}),
          ...(goalsParam ? { goals: goalsParam } : {}),
          ...(dateFrom && dateTo
            ? dateMode === 'expiring'
              ? { expiringFrom: dateFrom, expiringTo: dateTo }
              : { joinedFrom: dateFrom, joinedTo: dateTo }
            : {}),
        },
      });
      return response.data;
    },
    // Keeps the previous page visible while the next loads, so the table does
    // not collapse to a skeleton on every pagination click.
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Members
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.meta.total ?? 0} member
            {data?.meta.total === 1 ? '' : 's'}
            {activeFilterCount > 0 && ' matching your filters'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {expiringInDays && (
            <Button variant="outline" onClick={() => setRemindersOpen(true)}>
              <MessageSquare />
              Send reminders
            </Button>
          )}

          {/* Owner and manager only, matching the API. Showing this to a
              receptionist would hand them a button that 403s. */}
          {canImport && (
            <Button
              variant="outline"
              onClick={() => navigate('/members/import')}
            >
              <Upload />
              Import
            </Button>
          )}

          <Button onClick={() => navigate('/members/new')}>
            <UserPlus />
            New member
          </Button>
        </div>
      </div>

      {/* ── Stat strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatChip
          label="Total"
          value={stats?.total}
          active={!status && !expiringInDays && !hasDues}
          onClick={clearFilters}
        />
        <StatChip
          label="Active"
          value={stats?.active}
          tone="success"
          active={status === 'ACTIVE'}
          onClick={() => updateFilter('status', status === 'ACTIVE' ? '' : 'ACTIVE')}
        />
        <StatChip
          label="Expiring (7d)"
          value={stats?.expiringSoon}
          tone="warning"
          active={expiringInDays === '7'}
          onClick={() =>
            updateFilter('expiringInDays', expiringInDays === '7' ? '' : '7')
          }
        />
        <StatChip
          label="Expired"
          value={stats?.expired}
          tone="destructive"
          active={status === 'EXPIRED'}
          onClick={() =>
            updateFilter('status', status === 'EXPIRED' ? '' : 'EXPIRED')
          }
        />
        <StatChip
          label="Frozen"
          value={stats?.frozen}
          tone="info"
          active={status === 'FROZEN'}
          onClick={() =>
            updateFilter('status', status === 'FROZEN' ? '' : 'FROZEN')
          }
        />
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by name, ID or phone…"
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
            value={status || 'all'}
            onValueChange={(value) =>
              updateFilter('status', value === 'all' ? '' : value)
            }
          >
            <SelectTrigger className="w-[150px]">
              <SlidersHorizontal className="mr-1.5 size-4 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={hasDues === 'true' ? 'default' : 'outline'}
            size="default"
            onClick={() =>
              updateFilter('hasDues', hasDues === 'true' ? '' : 'true')
            }
          >
            <Filter />
            Has dues
          </Button>

          {/* Which date the range applies to. Shown only once a range is
              set: an empty toggle would be a control with no effect. */}
          {dateRange && (
            <SegmentedControl
              options={[
                { value: 'joined', label: 'Joined' },
                { value: 'expiring', label: 'Expiring' },
              ]}
              value={dateMode}
              onChange={(mode) => updateFilter('dateMode', mode)}
              ariaLabel="Filter dates by"
              size="sm"
            />
          )}

          <DateRangePicker
            value={dateRange}
            onChange={updateDateRange}
            onClear={() => updateDateRange(null)}
            label={dateMode === 'expiring' ? 'Expiring between' : 'Joined between'}
          />

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X />
              Clear
            </Button>
          )}
        </div>

        <Separator className="my-3" />

        <GoalFilter
          selected={selectedGoals}
          onChange={(goals) => updateFilter('goals', goals.join(','))}
        />
      </Card>

      {/* ── Table ───────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <TableSkeleton />
        ) : !data || data.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title={
              activeFilterCount > 0 || urlSearch
                ? 'No members match'
                : 'No members yet'
            }
            description={
              activeFilterCount > 0 || urlSearch
                ? 'Try adjusting or clearing your filters.'
                : 'Register your first member to get started.'
            }
            action={
              activeFilterCount > 0 || urlSearch ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => navigate('/members/new')}>
                  <UserPlus />
                  Register a member
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div
              className={cn(
                'hidden overflow-x-auto md:block',
                isFetching && 'opacity-60 transition-opacity',
              )}
            >
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-left">
                    <Th>Member</Th>
                    <Th>Plan &amp; period</Th>
                    <Th>Focus</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Paid</Th>
                    <Th className="text-right">Due</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((member, index) => (
                    <motion.tr
                      key={member.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(index * 0.02, 0.2) }}
                      className="group cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/50"
                      onClick={() => navigate(`/members/${member.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <MemberAvatar
                            name={member.fullName}
                            photoUrl={member.photoUrl}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {member.fullName}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              <span className="font-mono">{member.memberId}</span>
                              {' · '}
                              {formatPhone(member.phone)}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Start and end dates together: when a membership runs
                          from and until is one question, not two. */}
                      <td className="px-4 py-3">
                        {member.memberships[0] ? (
                          <>
                            <div className="text-sm">
                              {member.memberships[0].plan.name}
                            </div>
                            <div className="tabular text-xs text-muted-foreground">
                              {formatDate(member.memberships[0].startDate)} –{' '}
                              {formatDate(member.memberships[0].endDate)}
                            </div>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {member.goals.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {member.goals.slice(0, 2).map((goal) => (
                              <Badge key={goal} variant="secondary" size="sm">
                                {FITNESS_GOAL_LABELS[goal]}
                              </Badge>
                            ))}
                            {member.goals.length > 2 && (
                              <Badge variant="outline" size="sm">
                                +{member.goals.length - 2}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANTS[member.status]} dot>
                          {MEMBER_STATUS_LABELS[member.status]}
                        </Badge>
                        {member.memberships[0] && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {relativeExpiry(member.memberships[0].endDate)}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="tabular text-sm font-medium">
                          {formatINR(member.totalPaidPaise, {
                            showDecimals: false,
                          })}
                        </div>
                        {member.totalBilledPaise > member.totalPaidPaise && (
                          <div className="tabular text-[11px] text-muted-foreground">
                            of{' '}
                            {formatINR(member.totalBilledPaise, {
                              showDecimals: false,
                            })}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right">
                        {member.balanceDuePaise > 0 ? (
                          <span className="tabular font-semibold text-destructive">
                            {formatINR(member.balanceDuePaise, {
                              showDecimals: false,
                            })}
                          </span>
                        ) : (
                          <Badge variant="success" size="sm">
                            Paid
                          </Badge>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards — a 5-column table is unusable on a phone. */}
            <div className="divide-y divide-border md:hidden">
              {data.data.map((member) => (
                <Link
                  key={member.id}
                  to={`/members/${member.id}`}
                  className="flex items-center gap-3 p-4 transition-colors active:bg-accent"
                >
                  <MemberAvatar
                    name={member.fullName}
                    photoUrl={member.photoUrl}
                    className="size-11"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {member.fullName}
                      </span>
                      <Badge
                        variant={STATUS_VARIANTS[member.status]}
                        size="sm"
                        className="shrink-0"
                      >
                        {MEMBER_STATUS_LABELS[member.status]}
                      </Badge>
                    </div>

                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="size-3" />
                      {formatPhone(member.phone)}
                    </div>

                    {member.memberships[0] && (
                      <div className="tabular mt-1 text-xs text-muted-foreground">
                        {member.memberships[0].plan.name} ·{' '}
                        {formatDate(member.memberships[0].startDate)} –{' '}
                        {formatDate(member.memberships[0].endDate)}
                      </div>
                    )}

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="tabular text-xs">
                        <span className="text-muted-foreground">Paid </span>
                        <span className="font-medium">
                          {formatINR(member.totalPaidPaise, {
                            showDecimals: false,
                          })}
                        </span>
                      </span>

                      {member.balanceDuePaise > 0 && (
                        <span className="tabular text-xs font-semibold text-destructive">
                          {formatINR(member.balanceDuePaise, {
                            showDecimals: false,
                          })}{' '}
                          due
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>

            {/* Pagination */}
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

      <RenewalReminderDialog
        open={remindersOpen}
        onOpenChange={setRemindersOpen}
      />
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  );
}

function StatChip({
  label,
  value,
  tone = 'default',
  active,
  onClick,
}: {
  label: string;
  value?: number;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
  active?: boolean;
  onClick?: () => void;
}) {
  const toneStyles = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-info',
  } as const;

  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-xl border bg-card px-4 py-3 text-left transition-all',
        'hover:border-ring/40 hover:shadow-soft',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
      aria-pressed={active}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'tabular mt-1 font-display text-xl font-bold',
          toneStyles[tone],
        )}
      >
        {value ?? <Skeleton className="inline-block h-6 w-10" />}
      </div>
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 p-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden h-4 w-28 sm:block" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export { formatDate };
