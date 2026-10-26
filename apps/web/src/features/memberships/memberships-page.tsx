import {
  MEMBERSHIP_STATUS_LABELS,
  formatDate,
  formatINR,
  type MembershipActivity,
  type MembershipKind,
  type MembershipListItem,
  type MembershipStatus,
  type PaginatedResponse,
} from '@azf/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  IdCard,
  Search,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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

type Since = 'today' | 'week' | 'month' | 'all';

const SINCE_LABELS: Record<Exclude<Since, 'all'>, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
};

const KIND_LABELS: Record<MembershipKind, string> = {
  NEW: 'New member',
  RENEWAL: 'Renewal',
  UPGRADE: 'Upgrade',
  TRANSFER: 'Transfer',
  IMPORTED: 'Imported',
};

const KIND_VARIANTS: Record<
  MembershipKind,
  'success' | 'info' | 'warning' | 'secondary' | 'outline'
> = {
  NEW: 'success',
  RENEWAL: 'info',
  UPGRADE: 'warning',
  TRANSFER: 'secondary',
  IMPORTED: 'outline',
};

const STATUS_VARIANTS: Record<
  MembershipStatus,
  'success' | 'secondary' | 'info' | 'destructive' | 'outline'
> = {
  ACTIVE: 'success',
  EXPIRED: 'secondary',
  FROZEN: 'info',
  CANCELLED: 'destructive',
  UPGRADED: 'outline',
  TRANSFERRED: 'outline',
};

/**
 * Memberships — every membership, newest first.
 *
 * The register at the desk, the way the old software's "All Memberships"
 * page was: who joined or renewed, on which plan, for which dates, what
 * they paid and who entered it. Today, this week and this month are one tap
 * away, and every row opens the member's profile.
 *
 * Read-only: nothing on this page changes a membership.
 */
export function MembershipsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Number(searchParams.get('page')) || 1;
  const since = (searchParams.get('since') as Since | null) ?? 'all';
  const kind = searchParams.get('kind') ?? '';
  const status = searchParams.get('status') ?? '';
  const urlSearch = searchParams.get('search') ?? '';

  const [searchInput, setSearchInput] = React.useState(urlSearch);
  React.useEffect(() => setSearchInput(urlSearch), [urlSearch]);

  // Typing updates the URL after a pause, so a search is shareable and the
  // back button returns to it.
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
      // A new filter starts from page 1; paging itself keeps its page.
      if (key !== 'page') next.delete('page');
      return next;
    });
  }

  const activity = useQuery({
    queryKey: ['membership-activity'],
    queryFn: async () => {
      const response = await api.get<{ data: MembershipActivity }>(
        '/memberships/activity',
      );
      return response.data.data;
    },
    refetchInterval: 60_000,
  });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['memberships-list', page, since, kind, status, urlSearch],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<MembershipListItem>>(
        '/memberships',
        {
          params: {
            page,
            limit: 20,
            since,
            ...(kind ? { kind } : {}),
            ...(status ? { status } : {}),
            ...(urlSearch ? { search: urlSearch } : {}),
          },
        },
      );
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const filtered = Boolean(kind || status || urlSearch || since !== 'all');

  function clearFilters() {
    setSearchInput('');
    setSearchParams(new URLSearchParams());
  }

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
          Memberships
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data
            ? `${data.meta.total.toLocaleString('en-IN')} membership${data.meta.total === 1 ? '' : 's'}${filtered ? ' matching' : ''}, newest first`
            : 'Every membership, newest first'}
        </p>
      </div>

      {/* ── Today / week / month ────────────────────────────────────── */}
      {/* The cards are the period filter too: tap one to see just those,
          tap it again for every membership. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {(['today', 'week', 'month'] as const).map((key) => (
          <ActivityCard
            key={key}
            label={SINCE_LABELS[key]}
            counts={activity.data?.[key]}
            active={since === key}
            onClick={() => updateFilter('since', since === key ? '' : key)}
          />
        ))}
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
            value={kind || 'all'}
            onValueChange={(value) => updateFilter('kind', value === 'all' ? '' : value)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="NEW">New members</SelectItem>
              <SelectItem value="RENEWAL">Renewals</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={status || 'all'}
            onValueChange={(value) =>
              updateFilter('status', value === 'all' ? '' : value)
            }
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {Object.entries(MEMBERSHIP_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filtered && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X />
              Clear
            </Button>
          )}
        </div>
      </Card>

      {/* ── List ────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <ListSkeleton />
        ) : !data || data.data.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title={filtered ? 'No memberships match' : 'No memberships yet'}
            description={
              filtered
                ? 'Try another period, or clear the filters.'
                : 'Memberships appear here as members register and renew.'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
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
                    <Th>Plan</Th>
                    <Th>Period</Th>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Paid</Th>
                    <Th>Added</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, index) => (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(index * 0.02, 0.2) }}
                      className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/50"
                      onClick={() => navigate(`/members/${row.member.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <MemberAvatar
                            name={row.member.fullName}
                            photoUrl={row.member.photoUrl}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {row.member.fullName}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              <span className="font-mono">{row.member.memberId}</span>
                              {' · '}
                              {row.member.phone}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium">{row.plan.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.plan.durationDays} days
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap px-4 py-3 text-sm">
                        {formatDate(row.startDate)} – {formatDate(row.endDate)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={KIND_VARIANTS[row.kind]} size="sm">
                          {KIND_LABELS[row.kind]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANTS[row.status]} dot size="sm">
                          {MEMBERSHIP_STATUS_LABELS[row.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Money row={row} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="tabular text-sm">{formatDate(row.createdAt)}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.addedBy ? `by ${row.addedBy}` : 'Old software'}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone list: three lines a row, like the member list. */}
            <div className="divide-y divide-border md:hidden">
              {data.data.map((row) => (
                <Link
                  key={row.id}
                  to={`/members/${row.member.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-accent"
                >
                  <MemberAvatar
                    name={row.member.fullName}
                    photoUrl={row.member.photoUrl}
                    className="size-10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[15px] font-medium">
                        {row.member.fullName}
                      </span>
                      <Badge variant={KIND_VARIANTS[row.kind]} size="sm" className="shrink-0">
                        {KIND_LABELS[row.kind]}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {row.plan.name} · {MEMBERSHIP_STATUS_LABELS[row.status]}
                    </div>
                    <div className="tabular mt-0.5 truncate text-xs text-muted-foreground">
                      {formatDate(row.startDate)} – {formatDate(row.endDate)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money row={row} />
                  </div>
                </Link>
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

/** What was paid against the membership, and what is still owed. */
function Money({ row }: { row: MembershipListItem }) {
  return (
    <>
      <div className="tabular text-sm font-medium">
        {formatINR(row.paidPaise, { showDecimals: false })}
      </div>
      {row.balancePaise > 0 ? (
        <div className="tabular text-[11px] font-semibold text-destructive">
          {formatINR(row.balancePaise, { showDecimals: false })} due
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">
          {row.totalPaise > 0 ? 'Paid in full' : 'Free'}
        </div>
      )}
    </>
  );
}

/** Today / this week / this month, and a tap to see just those. */
function ActivityCard({
  label,
  counts,
  active,
  onClick,
}: {
  label: string;
  counts?: { total: number; new: number; renewals: number };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-w-0 rounded-xl border bg-card px-3 py-3 text-left transition-all sm:px-4',
        'hover:border-ring/40 hover:shadow-soft',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <div className="truncate text-[11px] text-muted-foreground sm:text-xs">
        {label}
      </div>
      {counts ? (
        <>
          <div className="tabular mt-0.5 font-display text-lg font-bold sm:mt-1 sm:text-2xl">
            {counts.total}
          </div>
          {/* Stacked on a phone, where a third of the width cannot hold
              both on one line. */}
          <div className="flex flex-col text-[11px] text-muted-foreground sm:flex-row sm:gap-1">
            <span className="truncate">{counts.new} new</span>
            <span className="hidden sm:inline">·</span>
            <span className="truncate">{counts.renewals} renewed</span>
          </div>
        </>
      ) : (
        <>
          <Skeleton className="mt-1.5 h-6 w-10" />
          <Skeleton className="mt-1.5 h-3 w-20" />
        </>
      )}
    </button>
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

function ListSkeleton() {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
