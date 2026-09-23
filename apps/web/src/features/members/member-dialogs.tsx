import {
  SMS_TEMPLATES,
  SmsTemplateKey,
  countSmsSegments,
  formatDate,
  renderSmsTemplate,
} from '@azf/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send, Snowflake } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface MemberRef {
  id: string;
  memberId: string;
  fullName: string;
  phone: string;
}

// ── Freeze ────────────────────────────────────────────────────────────────

interface FreezeForm {
  startDate: string;
  endDate: string;
  reason: string;
}

/**
 * Freeze a membership.
 *
 * Freezing preserves paid-for days: the expiry date is pushed out by exactly
 * the number of days paused when the membership resumes. The copy says so
 * explicitly, because a member being told "your membership is paused" will
 * immediately want to know whether they are losing time they paid for.
 */
export function FreezeDialog({
  open,
  onOpenChange,
  member,
  membershipId,
  currentEndDate,
  maxFreezeDays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberRef;
  membershipId: string | null;
  currentEndDate: string | null;
  maxFreezeDays: number;
}) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FreezeForm>({
    defaultValues: {
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      reason: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      reset({
        startDate: new Date().toISOString().slice(0, 10),
        endDate: '',
        reason: '',
      });
    }
  }, [open, reset]);

  const startDate = watch('startDate');
  const endDate = watch('endDate');

  const frozenDays =
    startDate && endDate
      ? Math.max(
          0,
          Math.round(
            (new Date(endDate).getTime() - new Date(startDate).getTime()) /
              86_400_000,
          ),
        )
      : null;

  const newExpiry =
    currentEndDate && frozenDays
      ? new Date(new Date(currentEndDate).getTime() + frozenDays * 86_400_000)
      : null;

  const mutation = useMutation({
    mutationFn: async (values: FreezeForm) => {
      await api.post('/memberships/freeze', {
        membershipId,
        startDate: values.startDate,
        endDate: values.endDate || undefined,
        reason: values.reason,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', member.id] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      toast.success('Membership frozen', {
        description: 'Remaining days are preserved and will resume on unfreeze.',
      });
      onOpenChange(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Freeze membership</DialogTitle>
          <DialogDescription>
            {member.fullName} · {member.memberId}
          </DialogDescription>
        </DialogHeader>

        {!membershipId ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This member has no active membership to freeze.
          </p>
        ) : (
          <form
            onSubmit={handleSubmit((v) => mutation.mutate(v))}
            className="mt-4 space-y-4"
            noValidate
          >
            <div className="rounded-xl bg-info/[0.08] px-4 py-3">
              <p className="text-[13px] leading-relaxed text-info">
                Frozen days are added back to the expiry date. The member does
                not lose time they have paid for.
                {maxFreezeDays > 0 && (
                  <> This plan allows up to {maxFreezeDays} freeze days.</>
                )}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label required className="text-[13px]">
                  From
                </Label>
                <Input
                  type="date"
                  error={Boolean(errors.startDate)}
                  {...register('startDate', { required: 'Required' })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px]">Until</Label>
                <Input
                  type="date"
                  min={startDate}
                  {...register('endDate')}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to unfreeze manually
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Reason
              </Label>
              <Input
                placeholder="Travelling, medical leave, work…"
                error={Boolean(errors.reason)}
                {...register('reason', {
                  required: 'A reason is required',
                  minLength: { value: 3, message: 'Please be more specific' },
                })}
              />
              {errors.reason && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.reason.message}
                </p>
              )}
            </div>

            {newExpiry && frozenDays ? (
              <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {frozenDays} day{frozenDays === 1 ? '' : 's'} frozen
                  </span>
                  <span className="font-medium">
                    New expiry {formatDate(newExpiry)}
                  </span>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={mutation.isPending}
                loadingText="Freezing…"
              >
                <Snowflake />
                Freeze
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Send SMS ──────────────────────────────────────────────────────────────

/**
 * Send a message to one member.
 *
 * The preview shows the rendered text and its billed segment count. That
 * count matters: a single non-GSM-7 character (a curly quote, a ₹ sign) cuts
 * the limit from 160 characters to 70 and silently doubles the cost of a
 * broadcast.
 */
export function SendSmsDialog({
  open,
  onOpenChange,
  member,
  expiryDate,
  balanceDuePaise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberRef;
  expiryDate: string | null;
  balanceDuePaise: number;
}) {
  const queryClient = useQueryClient();
  const [templateKey, setTemplateKey] = React.useState<SmsTemplateKey>(
    SmsTemplateKey.EXPIRY_REMINDER,
  );
  const [customMessage, setCustomMessage] = React.useState('');

  const variables = React.useMemo(
    () => ({
      name: member.fullName.split(' ')[0] ?? member.fullName,
      memberId: member.memberId,
      expiryDate: expiryDate ? formatDate(expiryDate) : '—',
      amount: String(Math.round(balanceDuePaise / 100)),
      gymPhone: '+91 90000 00000',
      days: '21',
      message: customMessage,
    }),
    [member, expiryDate, balanceDuePaise, customMessage],
  );

  const preview = React.useMemo(() => {
    const template = SMS_TEMPLATES[templateKey];
    return renderSmsTemplate(template.body, variables);
  }, [templateKey, variables]);

  const segments = countSmsSegments(preview);

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post('/sms/send', {
        to: member.phone,
        templateKey,
        variables,
        memberId: member.id,
        immediate: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sms-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['sms-stats'] });

      toast.success('Message queued', {
        description: 'Delivery status appears in Messages.',
      });
      onOpenChange(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  // Templates a member-level send makes sense for.
  const AVAILABLE: SmsTemplateKey[] = [
    SmsTemplateKey.EXPIRY_REMINDER,
    SmsTemplateKey.DUES_REMINDER,
    SmsTemplateKey.BIRTHDAY,
    SmsTemplateKey.WINBACK,
    SmsTemplateKey.CUSTOM,
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send message</DialogTitle>
          <DialogDescription>
            {member.fullName} · {member.phone}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">Template</Label>
            <Select
              value={templateKey}
              onValueChange={(v) => setTemplateKey(v as SmsTemplateKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE.map((key) => (
                  <SelectItem key={key} value={key}>
                    {SMS_TEMPLATES[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {templateKey === SmsTemplateKey.CUSTOM && (
            <div className="space-y-1.5">
              <Label className="text-[13px]">Message</Label>
              <Textarea
                rows={3}
                value={customMessage}
                onChange={(event) => setCustomMessage(event.target.value)}
                placeholder="Type your message…"
              />
              <p className="text-[11px] text-muted-foreground">
                Custom messages need their own DLT approval before they will
                deliver in India.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[13px]">Preview</Label>
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                {preview || 'Nothing to preview'}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-0.5">
              <Badge
                variant={segments.encoding === 'GSM-7' ? 'secondary' : 'warning'}
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
                {segments.length} characters ·{' '}
                {segments.segments} billed segment
                {segments.segments === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
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
            loadingText="Sending…"
            disabled={templateKey === SmsTemplateKey.CUSTOM && !customMessage.trim()}
          >
            <Send />
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { MessageSquare };
