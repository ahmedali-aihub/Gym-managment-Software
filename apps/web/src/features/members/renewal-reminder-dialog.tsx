import {
  daysUntil,
  formatDate,
  formatPhone,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  Mail,
  MessageCircle,
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
    email: string | null;
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
type ReminderKind = 'EXPIRY_REMINDER' | 'PAYMENT_DUE';
type Channel = 'whatsapp' | 'email';

export function RenewalReminderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const [windowDays, setWindowDays] = React.useState(7);
  const [kind, setKind] = React.useState<ReminderKind>('EXPIRY_REMINDER');
  // WhatsApp reaches every member; email only those who gave an address.
  // Both default on, and the owner unticks what they do not want.
  const [channels, setChannels] = React.useState<Channel[]>([
    'whatsapp',
    'email',
  ]);
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
  // A plain preview. The old version counted GSM-7 segments and estimated
  // a per-segment cost, which only ever mattered for SMS — WhatsApp and
  // email are priced per message, not per 160 characters.
  const preview = React.useMemo(() => {
    const first = selected[0];
    const name = first?.member.fullName.split(' ')[0] ?? 'there';
    const memberCode = first?.member.memberId ?? 'AZF-2026-0000';
    const expiry = first?.endDate ? formatDate(first.endDate) : '—';

    return kind === 'EXPIRY_REMINDER'
      ? `Hi ${name}, your A to Z Fitness membership (${memberCode}) expires on ${expiry}. Renew to keep training without a break.`
      : `Hi ${name}, your account ${memberCode} has a pending balance. Please settle it on your next visit.`;
  }, [selected, kind]);

  const withoutEmail = selected.filter((item) => !item.member.email).length;

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        data: { summary: Record<string, number> };
      }>('/notifications/reminders', {
        memberIds: selected.map((item) => item.member.id),
        kind,
        channels,
      });
      return response.data.data;
    },

    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['sms-logs'] });

      // Reported per channel. "42 reminders sent" is not a useful answer
      // when eleven of them had no email address to go to.
      const parts: string[] = [];
      if (result.summary.whatsappSent) {
        parts.push(`${result.summary.whatsappSent} on WhatsApp`);
      }
      if (result.summary.emailSent) {
        parts.push(`${result.summary.emailSent} by email`);
      }

      toast.success(parts.length ? `Sent ${parts.join(', ')}` : 'Nothing sent', {
        description: result.summary.emailSkipped
          ? `${result.summary.emailSkipped} had no email address on file.`
          : undefined,
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
                value={kind}
                onValueChange={(value) => setKind(value as ReminderKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EXPIRY_REMINDER">
                    Expiry reminder
                  </SelectItem>
                  <SelectItem value="PAYMENT_DUE">Dues reminder</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-1.5">
            <Label className="text-[13px]">Preview</Label>

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

          {/* Channels. Replaces the old per-segment cost estimate, which
              only ever applied to SMS — WhatsApp and email are priced per
              message, and both are free at this gym's volume. */}
          <div className="space-y-1.5">
            <Label className="text-[13px]">Send by</Label>
            <div className="flex flex-wrap gap-2">
              <ChannelToggle
                icon={MessageCircle}
                label="WhatsApp"
                detail={`reaches all ${selected.length}`}
                active={channels.includes('whatsapp')}
                onToggle={() =>
                  setChannels((c) =>
                    c.includes('whatsapp')
                      ? c.filter((x) => x !== 'whatsapp')
                      : [...c, 'whatsapp'],
                  )
                }
              />
              <ChannelToggle
                icon={Mail}
                label="Email"
                detail={
                  withoutEmail > 0
                    ? `${selected.length - withoutEmail} of ${selected.length} have one`
                    : `reaches all ${selected.length}`
                }
                active={channels.includes('email')}
                onToggle={() =>
                  setChannels((c) =>
                    c.includes('email')
                      ? c.filter((x) => x !== 'email')
                      : [...c, 'email'],
                  )
                }
              />
            </div>

            {channels.includes('email') && withoutEmail > 0 && (
              <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {withoutEmail} of these members have no email address, so they
                will only receive the WhatsApp message.
              </p>
            )}
          </div>
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

/**
 * A channel on/off pill.
 *
 * Both channels stay ENABLED even when some members lack an email: the
 * owner may still want to reach the ones who have an address, and the
 * count beside the label says how many that is.
 */
function ChannelToggle({
  icon: Icon,
  label,
  detail,
  active,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="font-medium">{label}</span>
      <span className="text-[11px] text-muted-foreground">{detail}</span>
    </button>
  );
}
