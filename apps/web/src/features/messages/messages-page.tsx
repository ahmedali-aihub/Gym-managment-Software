import {
  MESSAGE_STATUS_LABELS,
  formatDateTime,
  type MessageLogRow,
  type MessageStats,
  type MessageStatus,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { SegmentedControl } from '@/components/common/segmented-control';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type ChannelFilter = 'all' | 'email' | 'whatsapp';

const CHANNEL_OPTIONS: Array<{ value: ChannelFilter; label: string; shortLabel: string }> = [
  { value: 'all', label: 'All channels', shortLabel: 'All' },
  { value: 'email', label: 'Email', shortLabel: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp', shortLabel: 'WhatsApp' },
];

const STATUS_VARIANTS: Record<
  MessageStatus,
  'success' | 'destructive' | 'warning' | 'info' | 'secondary'
> = {
  QUEUED: 'secondary',
  SENDING: 'info',
  SENT: 'info',
  DELIVERED: 'success',
  FAILED: 'warning',
  DEAD: 'destructive',
};

const STATUS_ICONS: Record<MessageStatus, React.ComponentType<{ className?: string }>> = {
  QUEUED: Clock,
  SENDING: Send,
  SENT: Send,
  DELIVERED: CheckCheck,
  FAILED: AlertTriangle,
  DEAD: XCircle,
};

const CHANNEL_ICONS = {
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
} as const;

interface ProviderStatus {
  email: { provider: string; ok: boolean; message: string };
  whatsapp: { provider: string; ok: boolean; message: string };
}

/**
 * Messages.
 *
 * One history over both channels the app actually sends on — email and
 * WhatsApp — not two. Before this, the page showed an SMS log for a channel
 * the UI stopped offering months ago (see notify-dialog.tsx's own note on
 * why SMS stays wired on the backend but not here); nobody could see what
 * had actually gone out to members.
 *
 * Three views: the merged log, the failed queue that needs attention, and a
 * channel filter across both — a segmented control with the same drag
 * gesture as the nav bar and every other filter in the app, not a dropdown.
 *
 * The failed queue is its own tab rather than a filter on the log for the
 * same reason it always was: a message that failed permanently is a member
 * who did not get told their membership is expiring. That is a task, not a
 * record, and should not have to be hunted for behind a dropdown.
 */
export function MessagesPage() {
  const queryClient = useQueryClient();
  const [channel, setChannel] = React.useState<ChannelFilter>('all');

  const { data: stats } = useQuery({
    queryKey: ['message-stats'],
    queryFn: async () => {
      const response = await api.get<{ data: MessageStats }>('/messages/stats');
      return response.data.data;
    },
  });

  const { data: providerStatus } = useQuery({
    queryKey: ['message-provider'],
    queryFn: async () => {
      const response = await api.get<{ data: ProviderStatus }>('/messages/provider');
      return response.data.data;
    },
    // Provider health rarely changes; no need to poll it as often as the log.
    staleTime: 5 * 60 * 1000,
  });

  const logs = useQuery({
    queryKey: ['message-logs', channel],
    queryFn: async () => {
      const response = await api.get<{ data: MessageLogRow[] }>('/messages', {
        params: { limit: 30, channel },
      });
      return response.data.data;
    },
  });

  const failed = useQuery({
    queryKey: ['message-failed'],
    queryFn: async () => {
      const response = await api.get<{ data: MessageLogRow[] }>('/messages/failed', {
        params: { limit: 30 },
      });
      return response.data.data;
    },
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['message-logs'] });
    void queryClient.invalidateQueries({ queryKey: ['message-failed'] });
    void queryClient.invalidateQueries({ queryKey: ['message-stats'] });
  };

  const retryOne = useMutation({
    mutationFn: async (row: MessageLogRow) => {
      const response = await api.post<{ data: MessageLogRow }>(
        `/messages/${row.channel}/${row.id}/retry`,
      );
      return response.data.data;
    },
    onSuccess: (data) => {
      invalidateAll();
      if (data.status === 'SENT' || data.status === 'DELIVERED') {
        toast.success('Message sent');
      } else {
        toast.error('Still failing', {
          description: data.errorMessage ?? 'The provider rejected it again.',
        });
      }
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const retryAll = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        data: { attempted: number; succeeded: number; failed: number };
      }>('/messages/retry-all');
      return response.data.data;
    },
    onSuccess: (result) => {
      invalidateAll();
      toast.success(`${result.succeeded} of ${result.attempted} sent`, {
        description:
          result.failed > 0
            ? `${result.failed} still failing — check the error on each.`
            : undefined,
      });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const failedCount = (stats?.failed ?? 0) + (stats?.dead ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
            Messages
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Email and WhatsApp history — everything sent to members, in one place
          </p>
        </div>

        {providerStatus && (
          <div className="flex flex-wrap gap-2">
            <ProviderBadge
              icon={Mail}
              label="Email"
              status={providerStatus.email}
            />
            <ProviderBadge
              icon={MessageCircle}
              label="WhatsApp"
              status={providerStatus.whatsapp}
            />
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sent" value={stats?.total} />
        <StatCard label="Delivered" value={stats?.delivered} tone="success" />
        <StatCard label="Needs attention" value={failedCount} tone="destructive" />
        <StatCard
          label="Delivery rate"
          value={stats ? Math.round(stats.deliveryRate) : undefined}
          suffix="%"
        />
      </div>

      <Tabs defaultValue={failedCount > 0 ? 'failed' : 'all'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="all">
              <MessageSquare />
              All messages
            </TabsTrigger>
            <TabsTrigger value="failed">
              <AlertTriangle />
              Failed
              {failedCount > 0 && (
                <Badge variant="destructive" size="sm" className="ml-1">
                  {failedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {failedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => retryAll.mutate()}
              loading={retryAll.isPending}
              loadingText="Retrying…"
            >
              <RefreshCw />
              Retry all
            </Button>
          )}
        </div>

        <TabsContent value="all" className="space-y-4">
          <SegmentedControl
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={setChannel}
            ariaLabel="Channel"
          />
          <MessageList
            query={logs}
            emptyTitle="No messages yet"
            emptyDescription="Messages appear here as they are sent to members."
          />
        </TabsContent>

        <TabsContent value="failed">
          <MessageList
            query={failed}
            emptyTitle="Nothing failed"
            emptyDescription="Every message has been delivered or is still in the queue."
            onRetry={(row) => retryOne.mutate(row)}
            retryingId={retryOne.isPending ? retryOne.variables?.id : undefined}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProviderBadge({
  icon: Icon,
  label,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: { provider: string; ok: boolean; message: string };
}) {
  return (
    <div
      title={status.message}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        status.ok
          ? 'border-success/25 bg-success/10 text-success'
          : 'border-destructive/25 bg-destructive/10 text-destructive',
      )}
    >
      <Icon className="size-3" />
      {label}
      <span className="text-muted-foreground">·</span>
      <span className="capitalize text-muted-foreground">{status.provider}</span>
    </div>
  );
}

function MessageList({
  query,
  emptyTitle,
  emptyDescription,
  onRetry,
  retryingId,
}: {
  query: ReturnType<typeof useQuery<MessageLogRow[]>>;
  emptyTitle: string;
  emptyDescription: string;
  onRetry?: (row: MessageLogRow) => void;
  retryingId?: string;
}) {
  if (query.error) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <Card>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-2 px-5 py-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="ml-auto h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (!query.data || query.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={CheckCheck}
          title={emptyTitle}
          description={emptyDescription}
          className="py-12"
        />
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="divide-y divide-border">
        {query.data.map((message, index) => {
          const StatusIcon = STATUS_ICONS[message.status];
          const ChannelIcon = CHANNEL_ICONS[message.channel];
          const isRetrying = retryingId === message.id;

          return (
            <motion.div
              key={`${message.channel}-${message.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(index * 0.03, 0.25) }}
              className="px-4 py-4 sm:px-5"
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    message.status === 'DELIVERED' && 'bg-success/10 text-success',
                    (message.status === 'SENT' || message.status === 'SENDING') &&
                      'bg-info/10 text-info',
                    message.status === 'QUEUED' && 'bg-muted text-muted-foreground',
                    message.status === 'FAILED' && 'bg-warning/10 text-warning',
                    message.status === 'DEAD' &&
                      'bg-destructive/10 text-destructive',
                  )}
                >
                  <StatusIcon className="size-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">
                      {message.member?.fullName ?? message.to}
                    </span>
                    <Badge variant="outline" size="sm" className="gap-1">
                      <ChannelIcon className="size-3" />
                      {message.channel === 'EMAIL' ? 'Email' : 'WhatsApp'}
                    </Badge>
                    <Badge variant="secondary" size="sm">
                      {message.templateLabel}
                    </Badge>
                    <Badge variant={STATUS_VARIANTS[message.status]} size="sm">
                      {MESSAGE_STATUS_LABELS[message.status]}
                    </Badge>
                  </div>

                  <p className="mt-1.5 truncate text-[13px] leading-relaxed text-muted-foreground">
                    {message.preview}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{formatDateTime(message.createdAt)}</span>
                    <span>{message.to}</span>
                    {message.attempts > 1 && (
                      <span>
                        {message.attempts} of {message.maxAttempts} attempts
                      </span>
                    )}
                  </div>

                  {message.errorMessage && (
                    <div className="mt-2 rounded-lg bg-destructive/[0.07] px-2.5 py-1.5">
                      <p className="text-[12px] text-destructive">
                        <span className="font-medium">
                          {message.errorCode ?? 'Error'}
                        </span>
                        {' — '}
                        {message.errorMessage}
                      </p>
                    </div>
                  )}
                </div>

                {onRetry && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRetry(message)}
                    loading={isRetrying}
                    className="shrink-0"
                  >
                    <RefreshCw />
                    <span className="hidden sm:inline">Retry</span>
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}

function StatCard({
  label,
  value,
  suffix,
  tone = 'default',
}: {
  label: string;
  value?: number;
  suffix?: string;
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
      {value === undefined ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <p
          className={cn(
            'tabular mt-1.5 font-display text-2xl font-semibold tracking-tight',
            toneStyles[tone],
          )}
        >
          {value}
          {suffix}
        </p>
      )}
    </Card>
  );
}
