import {
  SMS_STATUS_LABELS,
  SMS_TEMPLATE_LABELS,
  formatDateTime,
  type SmsStatus,
  type SmsTemplateKey,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCheck,
  Clock,
  MessageSquare,
  RefreshCw,
  Send,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface SmsLog {
  id: string;
  toPhone: string;
  templateKey: SmsTemplateKey;
  body: string;
  status: SmsStatus;
  provider: string;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  segments: number;
  createdAt: string;
  sentAt: string | null;
  member: { id: string; memberId: string; fullName: string } | null;
}

interface SmsStats {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  dead: number;
  deliveryRate: number;
  segmentsUsed: number;
}

const STATUS_VARIANTS: Record<
  SmsStatus,
  'success' | 'destructive' | 'warning' | 'info' | 'secondary'
> = {
  QUEUED: 'secondary',
  SENDING: 'info',
  SENT: 'info',
  DELIVERED: 'success',
  FAILED: 'warning',
  DEAD: 'destructive',
};

const STATUS_ICONS: Record<
  SmsStatus,
  React.ComponentType<{ className?: string }>
> = {
  QUEUED: Clock,
  SENDING: Send,
  SENT: Send,
  DELIVERED: CheckCheck,
  FAILED: AlertTriangle,
  DEAD: XCircle,
};

/**
 * Messages.
 *
 * Two views: the full log, and the failed queue that needs attention.
 *
 * The failed queue is deliberately its own tab rather than a filter on the
 * log. A message that failed permanently is a member who did not get told
 * their membership is expiring — it is a task, not a record, and it should
 * not have to be hunted for behind a dropdown.
 */
export function MessagesPage() {
  const queryClient = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ['sms-stats'],
    queryFn: async () => {
      const response = await api.get<{ data: SmsStats }>('/sms/stats');
      return response.data.data;
    },
  });

  const logs = useQuery({
    queryKey: ['sms-logs'],
    queryFn: async () => {
      const response = await api.get<{ data: SmsLog[] }>('/sms/logs', {
        params: { limit: 30 },
      });
      return response.data.data;
    },
  });

  const failed = useQuery({
    queryKey: ['sms-failed'],
    queryFn: async () => {
      const response = await api.get<{ data: SmsLog[] }>('/sms/failed', {
        params: { limit: 30 },
      });
      return response.data.data;
    },
  });

  const retryOne = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post<{ data: SmsLog }>(`/sms/${id}/retry`);
      return response.data.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['sms-failed'] });
      void queryClient.invalidateQueries({ queryKey: ['sms-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['sms-stats'] });

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
      }>('/sms/retry-all');
      return response.data.data;
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['sms-failed'] });
      void queryClient.invalidateQueries({ queryKey: ['sms-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['sms-stats'] });

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
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-[28px]">
          Messages
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          SMS delivery log and failed-message queue
        </p>
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

        <TabsContent value="all">
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
            onRetry={(id) => retryOne.mutate(id)}
            retryingId={retryOne.isPending ? retryOne.variables : undefined}
          />
        </TabsContent>
      </Tabs>
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
  query: ReturnType<typeof useQuery<SmsLog[]>>;
  emptyTitle: string;
  emptyDescription: string;
  onRetry?: (id: string) => void;
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
          const Icon = STATUS_ICONS[message.status];
          const isRetrying = retryingId === message.id;

          return (
            <motion.div
              key={message.id}
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
                  <Icon className="size-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">
                      {message.member?.fullName ?? message.toPhone}
                    </span>
                    <Badge variant="secondary" size="sm">
                      {SMS_TEMPLATE_LABELS[message.templateKey]}
                    </Badge>
                    <Badge variant={STATUS_VARIANTS[message.status]} size="sm">
                      {SMS_STATUS_LABELS[message.status]}
                    </Badge>
                  </div>

                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {message.body}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>{formatDateTime(message.createdAt)}</span>
                    <span>
                      {message.segments} segment
                      {message.segments === 1 ? '' : 's'}
                    </span>
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
                    onClick={() => onRetry(message.id)}
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
