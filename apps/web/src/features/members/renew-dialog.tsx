import {
  calculateExpiryDate,
  formatDate,
  formatINR,
  rupeesToPaise,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, IndianRupee, RefreshCw, Sun } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
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
  sendSms: boolean;
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: { id: string; memberId: string; fullName: string };
  currentPlanId?: string | null;
  currentEndDate?: string | null;
}) {
  const queryClient = useQueryClient();

  const { data: plans } = useQuery({
    queryKey: ['plans-active'],
    queryFn: async () => {
      const response = await api.get<{ data: Plan[] }>('/plans/active');
      return response.data.data;
    },
    enabled: open,
  });

  const { register, handleSubmit, watch, setValue, reset } =
    useForm<RenewForm>();

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
      sendSms: true,
    });
  }, [open, currentPlanId, reset]);

  const planId = watch('planId');
  const continueFromExpiry = watch('continueFromExpiry');
  const paymentMode = watch('paymentMode');
  const amountPaidRupees = watch('amountPaidRupees');

  const plan = plans?.find((p) => p.id === planId);

  // Prefill the full price once a plan is chosen.
  React.useEffect(() => {
    if (plan && !amountPaidRupees) {
      setValue('amountPaidRupees', String(plan.pricePaise / 100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const expiryStillAhead = currentEndDate
    ? new Date(currentEndDate) > new Date()
    : false;

  const startDate = React.useMemo(() => {
    if (continueFromExpiry && expiryStillAhead && currentEndDate) {
      const next = new Date(currentEndDate);
      next.setDate(next.getDate() + 1);
      return next;
    }
    return new Date();
  }, [continueFromExpiry, expiryStillAhead, currentEndDate]);

  const newExpiry = plan
    ? calculateExpiryDate(startDate, plan.durationDays)
    : null;

  const balance = plan
    ? Math.max(
        0,
        plan.pricePaise - rupeesToPaise(Number(amountPaidRupees) || 0),
      )
    : 0;

  const mutation = useMutation({
    mutationFn: async (values: RenewForm) => {
      await api.post('/memberships/renew', {
        memberId: member.id,
        planId: values.planId,
        continueFromExpiry: values.continueFromExpiry,
        payment: {
          amountPaid: rupeesToPaise(Number(values.amountPaidRupees) || 0),
          mode: values.paymentMode,
          reference: values.reference || undefined,
        },
        sendSms: values.sendSms,
      });
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', member.id] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['member-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['today-collection'] });

      toast.success('Membership renewed');
      onOpenChange(false);
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

          {/* Early-renewal choice, shown only when it actually applies. */}
          {expiryStillAhead && (
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
                Amount collected
              </Label>
              <Input
                inputMode="decimal"
                icon={<IndianRupee />}
                {...register('amountPaidRupees')}
              />
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
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">New period</span>
                  <span className="tabular font-medium">
                    {formatDate(startDate)} – {formatDate(newExpiry)}
                  </span>
                </div>
                {balance > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Balance due</span>
                    <span className="tabular font-semibold text-destructive">
                      {formatINR(balance, { showDecimals: false })}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <Checkbox
              checked={watch('sendSms')}
              onCheckedChange={(checked) =>
                setValue('sendSms', checked === true)
              }
            />
            <span className="text-muted-foreground">
              Send confirmation SMS with the new dates
            </span>
          </label>

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
    new Date().toISOString().slice(0, 10),
  );

  React.useEffect(() => {
    if (open) setResumeDate(new Date().toISOString().slice(0, 10));
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
                ? { min: freezeStartDate.slice(0, 10) }
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
