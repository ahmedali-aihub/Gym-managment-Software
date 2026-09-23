import { formatDate, formatINR } from '@azf/shared';
import { useMutation } from '@tanstack/react-query';
import { Mail, MessageCircle, Send } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/misc';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Send a reminder to one member, over the channels the owner picks.
 *
 * WhatsApp and email only. SMS was removed from the UI: Indian
 * transactional SMS needs DLT registration to deliver at all, so offering
 * it here would hand the owner a channel that silently goes nowhere.
 *
 * WhatsApp reaches every member — a phone number is required — while email
 * reaches roughly half and carries the detail.
 *
 * The email option is DISABLED, not hidden, when the member has no address.
 * Hiding it would leave the owner wondering why a channel vanished; showing
 * it greyed out answers the question and prompts them to collect one.
 */

type Kind = 'EXPIRY_REMINDER' | 'PAYMENT_DUE';
// The API still accepts 'sms' — if the gym ever completes DLT
// registration, only this type and one row need to come back.
type Channel = 'whatsapp' | 'email';

export interface NotifyMember {
  id: string;
  memberId: string;
  fullName: string;
  phone: string;
  email: string | null;
}

export function NotifyDialog({
  open,
  onOpenChange,
  member,
  expiryDate,
  balanceDuePaise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: NotifyMember;
  expiryDate: string | null;
  balanceDuePaise: number;
}) {
  // Defaults follow the member's situation: someone who owes money is
  // chased about the money, not the expiry date.
  const [kind, setKind] = React.useState<Kind>(
    balanceDuePaise > 0 ? 'PAYMENT_DUE' : 'EXPIRY_REMINDER',
  );
  const [channels, setChannels] = React.useState<Channel[]>(['whatsapp']);

  React.useEffect(() => {
    if (open) {
      setKind(balanceDuePaise > 0 ? 'PAYMENT_DUE' : 'EXPIRY_REMINDER');
      setChannels(member.email ? ['whatsapp', 'email'] : ['whatsapp']);
    }
  }, [open, balanceDuePaise, member.email]);

  const toggle = (channel: Channel) =>
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((c) => c !== channel)
        : [...current, channel],
    );

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        data: { summary: Record<string, number> };
      }>('/notifications/reminders', {
        memberIds: [member.id],
        kind,
        channels,
      });
      return response.data.data;
    },
    onSuccess: (data) => {
      const sent: string[] = [];
      if (data.summary.whatsappSent) sent.push('WhatsApp');
      if (data.summary.emailSent) sent.push('email');

      toast.success(
        sent.length ? `Sent by ${sent.join(' and ')}` : 'Nothing was sent',
        {
          description: data.summary.emailSkipped
            ? 'Email skipped — no address on file.'
            : undefined,
        },
      );
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error('Could not send', { description: getErrorMessage(error) }),
  });

  const preview =
    kind === 'EXPIRY_REMINDER'
      ? `Hi ${member.fullName.split(' ')[0]}, your A to Z Fitness membership (${member.memberId}) expires on ${expiryDate ? formatDate(expiryDate) : '—'}. Renew to keep training without a break.`
      : `Hi ${member.fullName.split(' ')[0]}, your account ${member.memberId} has a pending balance of ${formatINR(balanceDuePaise, { showDecimals: false })}. Please settle it on your next visit.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send a reminder</DialogTitle>
          <DialogDescription>
            To {member.fullName} · {member.memberId}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* What to send */}
          <div>
            <p className="mb-2 text-[13px] font-medium">Reminder</p>
            <div className="grid grid-cols-2 gap-2">
              <KindButton
                active={kind === 'EXPIRY_REMINDER'}
                onClick={() => setKind('EXPIRY_REMINDER')}
                label="Membership expiry"
                detail={expiryDate ? formatDate(expiryDate) : 'No expiry set'}
              />
              <KindButton
                active={kind === 'PAYMENT_DUE'}
                onClick={() => setKind('PAYMENT_DUE')}
                label="Payment due"
                detail={
                  balanceDuePaise > 0
                    ? formatINR(balanceDuePaise, { showDecimals: false })
                    : 'Nothing owed'
                }
              />
            </div>
          </div>

          {/* How to send it */}
          <div>
            <p className="mb-2 text-[13px] font-medium">Send by</p>
            <div className="space-y-1.5">
              <ChannelRow
                icon={MessageCircle}
                label="WhatsApp"
                detail={member.phone}
                checked={channels.includes('whatsapp')}
                onToggle={() => toggle('whatsapp')}
              />
              <ChannelRow
                icon={Mail}
                label="Email"
                detail={member.email ?? 'No email address on file'}
                checked={channels.includes('email')}
                disabled={!member.email}
                onToggle={() => toggle('email')}
              />
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 px-3 py-2.5">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            <p className="text-[12px] leading-relaxed">{preview}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={channels.length === 0 || mutation.isPending}
          >
            <Send />
            {mutation.isPending ? 'Sending…' : 'Send reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindButton({
  active,
  onClick,
  label,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary bg-primary/10'
          : 'border-border hover:bg-muted/40',
      )}
    >
      <p className="text-[13px] font-medium">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
    </button>
  );
}

function ChannelRow({
  icon: Icon,
  label,
  detail,
  checked,
  disabled,
  onToggle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:bg-muted/40',
      )}
    >
      <Checkbox
        checked={checked && !disabled}
        disabled={disabled}
        onCheckedChange={() => !disabled && onToggle()}
      />
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
      </div>
    </label>
  );
}
