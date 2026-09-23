import { formatDate, formatPhone } from '@azf/shared';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CalendarClock,
  Phone,
  Plus,
  Target,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import * as React from 'react';
import { SegmentedControl } from '@/components/common/segmented-control';
import { EmptyState, ErrorState } from '@/components/common/states';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { LeadDetailDialog } from './lead-detail-dialog';
import { NewLeadDialog } from './new-lead-dialog';

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'TRIAL_SCHEDULED',
  'TRIAL_DONE',
  'NEGOTIATING',
  'CONVERTED',
  'LOST',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  TRIAL_SCHEDULED: 'Trial booked',
  TRIAL_DONE: 'Trial done',
  NEGOTIATING: 'Negotiating',
  CONVERTED: 'Joined',
  LOST: 'Lost',
};

export const SOURCE_LABELS: Record<string, string> = {
  WALK_IN: 'Walk-in',
  PHONE: 'Phone',
  REFERRAL: 'Referral',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
  GOOGLE: 'Google',
  WHATSAPP: 'WhatsApp',
  FLYER: 'Flyer',
  OTHER: 'Other',
};

const STATUS_VARIANTS: Record<
  LeadStatus,
  'default' | 'info' | 'warning' | 'success' | 'secondary'
> = {
  NEW: 'info',
  CONTACTED: 'default',
  TRIAL_SCHEDULED: 'warning',
  TRIAL_DONE: 'warning',
  NEGOTIATING: 'default',
  CONVERTED: 'success',
  LOST: 'secondary',
};

/** Columns shown in the pipeline. Converted and lost are terminal. */
const PIPELINE: LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'TRIAL_SCHEDULED',
  'TRIAL_DONE',
  'NEGOTIATING',
];

export interface LeadRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  source: string;
  status: LeadStatus;
  interestedIn: string | null;
  notes: string | null;
  followUpAt: string | null;
  lostReason: string | null;
  quotedPlan: { id: string; name: string; pricePaise: number } | null;
  assignedTo: { id: string; fullName: string } | null;
  activities: Array<{ type: string; summary: string; createdAt: string }>;
}

interface LeadStats {
  total: number;
  byStatus: Record<string, number>;
  bySource: Array<{ source: string; count: number }>;
  dueToday: number;
  overdue: number;
  conversionRatePercent: number | null;
}

/**
 * Lead pipeline.
 *
 * A gym's growth problem is rarely that nobody enquires — it is that
 * enquiries get forgotten. So the screen opens on ONE question: who needs
 * calling today?
 *
 * Overdue follow-ups lead, because a lead nobody called three days ago is
 * worth more attention than the pipeline's overall shape.
 */
export function LeadsPage() {
  const [newOpen, setNewOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<LeadRow | null>(null);
  const [view, setView] = React.useState<'due' | 'all'>('due');

  const stats = useQuery({
    queryKey: ['lead-stats'],
    queryFn: async () => {
      const response = await api.get<{ data: LeadStats }>('/leads/stats');
      return response.data.data;
    },
  });

  const leads = useQuery({
    queryKey: ['leads', view],
    queryFn: async () => {
      const response = await api.get<{ data: LeadRow[] }>('/leads', {
        params: { limit: 100, ...(view === 'due' ? { dueOnly: true } : {}) },
      });
      return response.data.data;
    },
  });

  const needsAttention = (stats.data?.overdue ?? 0) + (stats.data?.dueToday ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
            Enquiries
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            People who asked about joining, and who to call next
          </p>
        </div>

        <Button size="sm" onClick={() => setNewOpen(true)}>
          <Plus />
          New enquiry
        </Button>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Needs calling"
          value={stats.data ? needsAttention : undefined}
          sub={
            stats.data?.overdue
              ? `${stats.data.overdue} overdue`
              : 'Due today or earlier'
          }
          icon={Phone}
          tone={stats.data?.overdue ? 'destructive' : 'default'}
        />
        <StatCard
          label="In pipeline"
          value={
            stats.data
              ? PIPELINE.reduce(
                  (sum, status) => sum + (stats.data.byStatus[status] ?? 0),
                  0,
                )
              : undefined
          }
          sub="Not yet joined or lost"
          icon={Target}
        />
        <StatCard
          label="Joined"
          value={stats.data?.byStatus.CONVERTED ?? 0}
          sub="Converted to members"
          icon={UserPlus}
          tone="success"
        />
        <StatCard
          label="Conversion"
          value={stats.data?.conversionRatePercent ?? undefined}
          suffix="%"
          sub="Last 30 days"
          icon={TrendingUp}
          tone="success"
        />
      </div>

      {/* ── Pipeline summary ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <h3 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline
          </h3>

          {stats.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {PIPELINE.map((status) => (
                <div
                  key={status}
                  className="rounded-xl border border-border px-3 py-2.5"
                >
                  <p className="truncate text-[11px] text-muted-foreground">
                    {STATUS_LABELS[status]}
                  </p>
                  <p className="tabular mt-1 font-display text-xl font-semibold">
                    {stats.data?.byStatus[status] ?? 0}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Lead list ────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <SegmentedControl
            options={[
              { value: 'due', label: 'Needs calling' },
              { value: 'all', label: 'All enquiries' },
            ]}
            value={view}
            onChange={(next) => setView(next as typeof view)}
            ariaLabel="Enquiry view"
          />

          {leads.data && (
            <span className="text-[13px] text-muted-foreground">
              {leads.data.length} shown
            </span>
          )}
        </div>

        {leads.error ? (
          <ErrorState error={leads.error} onRetry={() => void leads.refetch()} />
        ) : leads.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 p-4">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        ) : !leads.data || leads.data.length === 0 ? (
          <EmptyState
            icon={view === 'due' ? CalendarClock : Target}
            title={
              view === 'due' ? 'Nobody to call' : 'No enquiries yet'
            }
            description={
              view === 'due'
                ? 'Every follow-up is scheduled for a future date.'
                : 'Record an enquiry when someone asks about joining.'
            }
            action={
              view === 'all' ? (
                <Button onClick={() => setNewOpen(true)}>
                  <Plus />
                  New enquiry
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {leads.data.map((lead, index) => {
              const overdue =
                lead.followUpAt && new Date(lead.followUpAt) < startOfToday();

              return (
                <motion.button
                  key={lead.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(index * 0.02, 0.2) }}
                  onClick={() => setSelected(lead)}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent/40"
                >
                  <MemberAvatar name={lead.fullName} className="size-10" />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">
                        {lead.fullName}
                      </span>
                      <Badge variant={STATUS_VARIANTS[lead.status]} size="sm">
                        {STATUS_LABELS[lead.status]}
                      </Badge>
                      <Badge variant="outline" size="sm">
                        {SOURCE_LABELS[lead.source] ?? lead.source}
                      </Badge>
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{formatPhone(lead.phone)}</span>
                      {lead.quotedPlan && (
                        <span>Quoted {lead.quotedPlan.name}</span>
                      )}
                    </div>

                    {lead.activities[0] && (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {lead.activities[0].summary}
                      </p>
                    )}
                  </div>

                  {lead.followUpAt && (
                    <div
                      className={cn(
                        'shrink-0 text-right',
                        overdue ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      <div className="flex items-center gap-1 text-[11px] font-medium">
                        {overdue && <AlertCircle className="size-3" />}
                        {overdue ? 'Overdue' : 'Follow up'}
                      </div>
                      <div className="tabular text-[11px]">
                        {formatDate(lead.followUpAt)}
                      </div>
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        )}
      </Card>

      <NewLeadDialog open={newOpen} onOpenChange={setNewOpen} />

      <LeadDetailDialog
        lead={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function StatCard({
  label,
  value,
  sub,
  suffix,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value?: number | null;
  sub: string;
  suffix?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'destructive';
}) {
  const toneStyles = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-success/10 text-success',
    destructive: 'bg-destructive/10 text-destructive',
  } as const;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted-foreground">{label}</p>

          {value === undefined ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <p
              className={cn(
                'tabular mt-1.5 font-display text-[24px] font-semibold leading-none tracking-tight',
                tone === 'destructive' && 'text-destructive',
                tone === 'success' && 'text-success',
              )}
            >
              {value === null ? '—' : value}
              {value !== null && suffix}
            </p>
          )}

          <p className="mt-2 text-[11px] text-muted-foreground">{sub}</p>
        </div>

        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            toneStyles[tone],
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>
    </Card>
  );
}
