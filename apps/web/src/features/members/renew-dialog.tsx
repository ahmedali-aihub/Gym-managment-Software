import {
  calculateExpiryDate,
  formatDate,
  formatDateLong,
  formatINR,
  rupeesToPaise,
  toDateInputValue,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  IndianRupee,
  Mail,
  MessageCircle,
  Pencil,
  RefreshCw,
  Sun,
} from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { showSuccessNotice } from '@/components/common/success-notice';
import type { WhatsAppSendState } from '@/components/common/whatsapp-send-dialog';
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
import { Checkbox, Separator } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { openWhatsApp, type WhatsAppMessage } from '@/lib/whatsapp';

interface Plan {
  id: string;
  name: string;
  durationDays: number;
  pricePaise: number;
}

interface RenewForm {
  planId: string;
  continueFromExpiry: boolean;
  amountPaidRupees: string;
  paymentMode: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING';
  reference: string;
}

/**
 * Renew a membership.
 *
 * `continueFromExpiry` is the detail that matters: a member renewing a week
 * early should not forfeit that week. When their current membership is still
 * running, the new period starts the day after it ends rather than today.
 * The dialog shows both dates so the choice is visible, not implied.
 */
export function RenewDialog({
  open,
  onOpenChange,
  member,
  currentPlanId,
  currentEndDate,
  onWhatsAppOpened,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: {
    id: string;
    memberId: string;
    fullName: string;
    email?: string | null;
  };
  currentPlanId?: string | null;
  currentEndDate?: string | null;
  /** Called with the renewal message, so the profile can offer it again. */
  onWhatsAppOpened?: (state: WhatsAppSendState) => void;
}) {
  const queryClient = useQueryClient();
  // A start date typed by hand, overriding the automatic one. Null until
  // the desk chooses to change it.
  const [customStart, setCustomStart] = React.useState<string | null>(null);

  const { data: plans } = useQuery({
    queryKey: ['plans-active'],
    queryFn: async () => {
      const response = await api.get<{ data: Plan[] }>('/plans/active');
      return response.data.data;
    },
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<RenewForm>();

  React.useEffect(() => {
    if (!open) return;
    reset({
      // Default to the plan they are already on — most renewals are
      // like-for-like, and changing plan is the exception.
      planId: currentPlanId ?? '',
      continueFromExpiry: true,
      amountPaidRupees: '',
      paymentMode: 'CASH',
      reference: '',
    });
    setCustomStart(null);
  }, [open, currentPlanId, reset]);

  const planId = watch('planId');
  const continueFromExpiry = watch('continueFromExpiry');
  const paymentMode = watch('paymentMode');
  const amountPaidRupees = watch('amountPaidRupees');

  const plan = plans?.find((p) => p.id === planId);

  // Each plan picked fills in its own price, ready to be lowered to what
  // the member is actually paying. Filling only an empty box left ₹2,000 in
  // place after switching from 1 Month to 3 Months.
  React.useEffect(() => {
    if (plan) setValue('amountPaidRupees', String(plan.pricePaise / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const expiryStillAhead = currentEndDate
    ? new Date(currentEndDate) > new Date()
    : false;

  const startDate = React.useMemo(() => {
    if (customStart) return new Date(`${customStart}T00:00:00`);
    if (continueFromExpiry && expiryStillAhead && currentEndDate) {
      const next = new Date(currentEndDate);
      next.setDate(next.getDate() + 1);
      return next;
    }
    return new Date();
  }, [customStart, continueFromExpiry, expiryStillAhead, currentEndDate]);

  const newExpiry = plan
    ? calculateExpiryDate(startDate, plan.durationDays)
    : null;

  // The amount typed is the price agreed: anything below the plan price is
  // a discount, not a due (the owner's rule, same as registration).
  const discount = plan
    ? Math.max(
        0,
        plan.pricePaise - rupeesToPaise(Number(amountPaidRupees) || 0),
      )
    : 0;

  const mutation = useMutation({
    mutationFn: async (values: RenewForm) => {
      const response = await api.post<{
        data: { id: string; whatsapp: WhatsAppMessage | null };
      }>('/memberships/renew', {
        memberId: member.id,
        planId: values.planId,
        continueFromExpiry: values.continueFromExpiry,
        // Only when changed by hand; otherwise the server works it out the
        // same way this dialog previews it.
        ...(customStart ? { startDate: customStart } : {}),
        payment: {
          amountPaid: rupeesToPaise(Number(values.amountPaidRupees) || 0),
          mode: values.paymentMode,
          discountAmount: discount,
          discountReason: discount ? 'Amount agreed at the desk' : undefined,
          reference: values.reference || undefined,
        },
        // SMS is not set up (Indian SMS needs DLT registration); the member
        // hears by email and WhatsApp instead.
        sendSms: false,
      });
      return response.data.data;
    },

    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['member', member.id] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['member-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['today-collection'] });

      // WhatsApp opens with the renewal message from here, while the
      // browser still counts this as part of the Renew click.
      const opened = data.whatsapp ? openWhatsApp(data.whatsapp) : false;

      showSuccessNotice({
        title: 'Membership renewed',
        name: member.fullName,
        details: [
          plan?.name,
          newExpiry && `Valid till ${formatDateLong(newExpiry)}`,
        ].filter((detail): detail is string => Boolean(detail)),
        note: member.email ? 'Receipt emailed to the member.' : undefined,
      });
      onOpenChange(false);

      if (data.whatsapp) {
        onWhatsAppOpened?.({
          title: 'Renewal confirmation',
          recipient: member.fullName,
          message: data.whatsapp,
          opened,
        });
      }
    },

    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Renew membership</DialogTitle>
          <DialogDescription>
            {member.fullName} · {member.memberId}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          className="mt-4 space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label required className="text-[13px]">
              Plan
            </Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {plans?.map((option) => {
                const selected = option.id === planId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setValue('planId', option.id)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-all',
                      selected
                        ? 'border-primary bg-primary/[0.06] ring-1 ring-primary'
                        : 'border-border hover:border-ring/40',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">
                        {option.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {option.durationDays} days
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="tabular text-[13px] font-semibold">
                        {formatINR(option.pricePaise, { showDecimals: false })}
                      </span>
                      {selected && <Check className="size-3.5 text-primary" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Early-renewal choice, shown only when it actually applies —
              and not once a start date has been typed by hand. */}
          {expiryStillAhead && !customStart && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-info/[0.07] px-4 py-3">
              <Checkbox
                checked={continueFromExpiry}
                onCheckedChange={(checked) =>
                  setValue('continueFromExpiry', checked === true)
                }
                className="mt-0.5"
              />
              <span className="text-[13px] leading-relaxed text-info">
                Start after the current membership ends on{' '}
                <strong className="font-semibold">
                  {formatDate(currentEndDate!)}
                </strong>
                , so no paid days are lost.
              </span>
            </label>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Amount paying
              </Label>
              <Input
                inputMode="decimal"
                icon={<IndianRupee />}
                error={Boolean(errors.amountPaidRupees)}
                {...register('amountPaidRupees', {
                  validate: (value) =>
                    !plan ||
                    rupeesToPaise(Number(value) || 0) <= plan.pricePaise ||
                    'Cannot be more than the plan price',
                })}
              />
              {errors.amountPaidRupees && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.amountPaidRupees.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Mode
              </Label>
              <Select
                value={paymentMode}
                onValueChange={(v) =>
                  setValue('paymentMode', v as RenewForm['paymentMode'])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                  <SelectItem value="NET_BANKING">Net Banking</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentMode !== 'CASH' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label required className="text-[13px]">
                  Reference
                </Label>
                <Input
                  placeholder="UPI transaction ID / auth code"
                  {...register('reference', { required: true })}
                />
              </div>
            )}
          </div>

          {newExpiry && (
            <>
              <Separator />
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">New period</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular font-medium">
                      {formatDate(startDate)} – {formatDate(newExpiry)}
                    </span>
                    {!customStart && (
                      <button
                        type="button"
                        onClick={() =>
                          setCustomStart(toDateInputValue(startDate))
                        }
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Pencil className="size-3" />
                        Change
                      </button>
                    )}
                  </span>
                </div>

                {/* The automatic dates are right almost every time; this is
                    for the exception, like a member who paid last week and
                    is only being entered now. The end follows the plan. */}
                {customStart && (
                  <div className="space-y-1.5 rounded-xl bg-muted/50 px-3 py-3">
                    <Label className="text-[13px]">Starts on</Label>
                    <Input
                      type="date"
                      value={customStart}
                      onChange={(event) =>
                        setCustomStart(event.target.value || null)
                      }
                    />
                    <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                      <span>
                        Ends {formatDate(newExpiry)} · {plan?.durationDays} days
                      </span>
                      <button
                        type="button"
                        onClick={() => setCustomStart(null)}
                        className="font-medium text-primary hover:underline"
                      >
                        Use automatic dates
                      </button>
                    </div>
                  </div>
                )}
                {discount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Discount</span>
                    <span className="tabular font-semibold text-success">
                      {formatINR(discount, { showDecimals: false })} · nothing due
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* What happens next, instead of an SMS option for a channel
              that is not set up. */}
          <div className="rounded-xl bg-muted/40 px-3.5 py-3">
            <p className="text-[13px] font-medium">After you renew</p>
            <ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground">
              <li className="flex items-center gap-2">
                <Mail className="size-3.5 shrink-0" />
                {member.email
                  ? 'The receipt is emailed to the member automatically'
                  : 'No email on file, so no receipt email'}
              </li>
              <li className="flex items-center gap-2">
                <MessageCircle className="size-3.5 shrink-0" />
                WhatsApp opens with the renewal message — you just press Send
              </li>
            </ul>
          </div>

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
              loadingText="Renewing…"
              disabled={!planId}
            >
              <RefreshCw />
              Renew
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Resume a frozen membership.
 *
 * Kept deliberately minimal: the only real input is the resume date, and the
 * dialog's job is to show how many days will be added back to the expiry so
 * the member can be told before it commits.
 */
export function UnfreezeDialog({
  open,
  onOpenChange,
  member,
  membershipId,
  freezeStartDate,
  currentEndDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { id: string; memberId: string; fullName: string };
  membershipId: string | null;
  freezeStartDate: string | null;
  currentEndDate: string | null;
}) {
  const queryClient = useQueryClient();
  const [resumeDate, setResumeDate] = React.useState(
    toDateInputValue(new Date()),
  );

  React.useEffect(() => {
    if (open) setResumeDate(toDateInputValue(new Date()));
  }, [open]);

  const frozenDays = freezeStartDate
    ? Math.max(
        0,
        Math.round(
          (new Date(resumeDate).getTime() -
            new Date(freezeStartDate).getTime()) /
            86_400_000,
        ),
      )
    : 0;

  const newExpiry = currentEndDate
    ? new Date(new Date(currentEndDate).getTime() + frozenDays * 86_400_000)
    : null;

  const mutation = useMutation({
    mutationFn: async () => {
      await api.post(`/memberships/${membershipId}/unfreeze`, { resumeDate });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', member.id] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      toast.success('Membership resumed', {
        description: `${frozenDays} day${frozenDays === 1 ? '' : 's'} added back to the expiry date.`,
      });
      onOpenChange(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resume membership</DialogTitle>
          <DialogDescription>
            {member.fullName} · {member.memberId}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label required className="text-[13px]">
              Resuming from
            </Label>
            <Input
              type="date"
              value={resumeDate}
              onChange={(event) => setResumeDate(event.target.value)}
              {...(freezeStartDate
                ? { min: toDateInputValue(freezeStartDate) }
                : {})}
            />
          </div>

          <div className="rounded-xl bg-muted/50 px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {frozenDays} day{frozenDays === 1 ? '' : 's'} frozen
              </span>
              {newExpiry && (
                <span className="tabular font-medium">
                  New expiry {formatDate(newExpiry)}
                </span>
              )}
            </div>
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
            loadingText="Resuming…"
          >
            <Sun />
            Resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
