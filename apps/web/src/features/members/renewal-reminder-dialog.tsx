import {
  SMS_TEMPLATES,
  SmsTemplateKey,
  countSmsSegments,
  daysUntil,
  formatDate,
  formatINR,
  formatPhone,
  renderSmsTemplate,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  MessageSquare,
  Send,
} from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/states';
import { MemberAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox, Separator } from '@/components/ui/misc';
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

interface ExpiringMembership {
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
}

const WINDOWS = [
  { days: 3, label: 'Next 3 days' },
  { days: 7, label: 'Next 7 days' },
  { days: 15, label: 'Next 15 days' },
  { days: 30, label: 'Next 30 days' },
] as const;

/**
 * Renewal reminders.
 *
 * The whole point is that chasing expiring members should take one action,
 * not twenty. So: pick a window, review who is in it, uncheck anyone you have
 * already spoken to, and send.
 *
 * Everyone is selected by default because the common case is "remind them
 * all" — making the user tick twenty boxes to do the obvious thing is the
 * bulk-action equivalent of a wizard.
 *
 * The cost line is not decoration. At ₹0.20 a segment a careless broadcast to
 * 200 members is real money, and the count changes with the template, so it
 * belongs next to the Send button.
 */
export function RenewalReminderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const [windowDays, setWindowDays] = React.useState(7);
  const [templateKey, setTemplateKey] = React.useState<SmsTemplateKey>(
    SmsTemplateKey.EXPIRY_REMINDER,
  );
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['expiring', windowDays],
    queryFn: async () => {
      const response = await api.get<{ data: ExpiringMembership[] }>(
        '/memberships/expiring',
        { params: { days: windowDays } },
      );
      return response.data.data;
    },
    enabled: open,
  });

  // Changing the window changes who is listed, so stale exclusions would
  // silently skip people the user never saw.
  React.useEffect(() => {
    setExcluded(new Set());
  }, [windowDays]);

  React.useEffect(() => {
    if (open) setExcluded(new Set());
  }, [open]);

  const selected = React.useMemo(
    () => (data ?? []).filter((item) => !excluded.has(item.member.id)),
    [data, excluded],
  );

  /**
   * Preview using the FIRST selected member's real values.
   *
   * A preview full of {{placeholders}} tells you nothing about whether the
   * message reads well, and the segment count would be wrong too.
   */
  const preview = React.useMemo(() => {
    const first = selected[0];
    const template = SMS_TEMPLATES[templateKey];

    return renderSmsTemplate(template.body, {
      name: first ? (first.member.fullName.split(' ')[0] ?? '') : 'Rahul',
      memberId: first?.member.memberId ?? 'AZF-2026-0001',
      expiryDate: first ? formatDate(first.endDate) : formatDate(new Date()),
      amount: '0',
      days: '21',
      gymPhone: '+91 90000 00000',
    });
  }, [selected, templateKey]);

  const segments = countSmsSegments(preview);
  const totalSegments = segments.segments * selected.length;
  // Typical Indian transactional SMS rate.
  const estimatedCostPaise = totalSegments * 20;

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        data: { queued: number; skipped: number };
      }>('/sms/send-bulk', {
        memberIds: selected.map((item) => item.member.id),
        templateKey,
        variables: {},
      });
      return response.data.data;
    },

    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['sms-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['sms-stats'] });

      toast.success(`${result.queued} reminders queued`, {
        description: 'Delivery status appears in Messages.',
      });
      onOpenChange(false);
    },

    onError: (error) => toast.error(getErrorMessage(error)),
  });

  function toggle(memberId: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  const allSelected = data ? excluded.size === 0 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send renewal reminders</DialogTitle>
          <DialogDescription>
            Remind members whose membership is about to lapse
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">Expiring within</Label>
              <Select
                value={String(windowDays)}
                onValueChange={(value) => setWindowDays(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOWS.map((option) => (
                    <SelectItem key={option.days} value={String(option.days)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Message</Label>
              <Select
                value={templateKey}
                onValueChange={(value) =>
                  setTemplateKey(value as SmsTemplateKey)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SmsTemplateKey.EXPIRY_REMINDER}>
                    Expiry reminder
                  </SelectItem>
                  <SelectItem value={SmsTemplateKey.DUES_REMINDER}>
                    Dues reminder
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[13px]">Preview</Label>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    segments.encoding === 'GSM-7' ? 'secondary' : 'warning'
                  }
                  size="sm"
                >
                  {segments.encoding}
                </Badge>
                <span
                  className={cn(
                    'text-[11px]',
                    segments.segments > 1
                      ? 'font-medium text-warning'
                      : 'text-muted-foreground',
                  )}
                >
                  {segments.segments} segment
                  {segments.segments === 1 ? '' : 's'} each
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                {preview}
              </p>
            </div>
          </div>

          <Separator />

          {/* Recipients */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-[13px]">
                Recipients
                {data && data.length > 0 && (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {selected.length} of {data.length}
                  </span>
                )}
              </Label>

              {data && data.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[12px]"
                  onClick={() =>
                    setExcluded(
                      allSelected
                        ? new Set(data.map((item) => item.member.id))
                        : new Set(),
                    )
                  }
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </Button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
              {isLoading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-2.5">
                      <Skeleton className="size-4 rounded" />
                      <Skeleton className="size-8 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              ) : !data || data.length === 0 ? (
                <EmptyState
                  icon={CheckCheck}
                  title="Nothing expiring"
                  description={`No memberships lapse in the next ${windowDays} days.`}
                  className="py-8"
                />
              ) : (
                <div className="divide-y divide-border">
                  {data.map((item) => {
                    const isSelected = !excluded.has(item.member.id);
                    const days = daysUntil(item.endDate);

                    return (
                      <label
                        key={item.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors',
                          isSelected ? 'hover:bg-accent/50' : 'opacity-50',
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggle(item.member.id)}
                          className="size-4"
                        />

                        <MemberAvatar
                          name={item.member.fullName}
                          photoUrl={item.member.photoUrl}
                          className="size-8"
                        />

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">
                            {item.member.fullName}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {formatPhone(item.member.phone)} · {item.plan.name}
                          </p>
                        </div>

                        <Badge
                          variant={days <= 2 ? 'destructive' : 'warning'}
                          size="sm"
                          className="shrink-0"
                        >
                          {days === 0
                            ? 'Today'
                            : days === 1
                              ? 'Tomorrow'
                              : `${days}d`}
                        </Badge>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Cost */}
          {selected.length > 0 && (
            <div className="flex items-center gap-2.5 rounded-xl bg-muted/50 px-4 py-2.5">
              <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
              <p className="flex-1 text-[12px] text-muted-foreground">
                {selected.length} message{selected.length === 1 ? '' : 's'} ·{' '}
                {totalSegments} segment{totalSegments === 1 ? '' : 's'}
              </p>
              <span className="tabular text-[13px] font-medium">
                ≈ {formatINR(estimatedCostPaise, { showDecimals: false })}
              </span>
            </div>
          )}

          {segments.segments > 1 && selected.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl bg-warning/[0.08] px-4 py-2.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <p className="text-[12px] leading-relaxed text-warning">
                This message spans {segments.segments} segments, so it costs{' '}
                {segments.segments}× per member. Shortening it below 160
                characters would halve the bill.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-5">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            loadingText="Queueing…"
            disabled={selected.length === 0}
          >
            <Send />
            Send {selected.length > 0 ? selected.length : ''} reminder
            {selected.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { CalendarClock };
