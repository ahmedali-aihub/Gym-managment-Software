import { formatINR, paiseToRupees, rupeesToPaise } from '@azf/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, Receipt } from 'lucide-react';
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

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: {
    id: string;
    memberId: string;
    fullName: string;
  };
  balanceDuePaise: number;
}

interface PaymentForm {
  amountRupees: string;
  mode: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING';
  reference: string;
  notes: string;
  sendSms: boolean;
}

/**
 * Record a payment against a member.
 *
 * `idempotencyKey` is generated once per dialog opening, not per submit. That
 * is the whole point: if a receptionist double-clicks, or the request is
 * retried after a timeout, the server sees the same key and returns the
 * original payment rather than taking the money twice.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  member,
  balanceDuePaise,
}: RecordPaymentDialogProps) {
  const queryClient = useQueryClient();

  // Regenerated each time the dialog opens, so a second, genuinely separate
  // payment is not suppressed as a duplicate.
  const idempotencyKey = React.useMemo(
    () => crypto.randomUUID(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<PaymentForm>({
    defaultValues: {
      amountRupees: String(paiseToRupees(balanceDuePaise)),
      mode: 'CASH',
      reference: '',
      notes: '',
      sendSms: true,
    },
  });

  // Refill when the balance changes between openings.
  React.useEffect(() => {
    if (open) {
      reset({
        amountRupees: String(paiseToRupees(balanceDuePaise)),
        mode: 'CASH',
        reference: '',
        notes: '',
        sendSms: true,
      });
    }
  }, [open, balanceDuePaise, reset]);

  const mode = watch('mode');
  const amountRupees = watch('amountRupees');
  const amountPaise = rupeesToPaise(Number(amountRupees) || 0);
  const remaining = Math.max(0, balanceDuePaise - amountPaise);

  const mutation = useMutation({
    mutationFn: async (values: PaymentForm) => {
      const response = await api.post<{
        data: { payment: { id: string }; balance: { balanceDuePaise: number } };
      }>('/payments', {
        memberId: member.id,
        amountPaise: rupeesToPaise(Number(values.amountRupees) || 0),
        mode: values.mode,
        reference: values.reference || undefined,
        notes: values.notes || undefined,
        generateInvoice: true,
        sendSms: values.sendSms,
        idempotencyKey,
      });

      return response.data.data;
    },

    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['member', member.id] });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
      void queryClient.invalidateQueries({ queryKey: ['payment-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      toast.success('Payment recorded', {
        description:
          data.balance.balanceDuePaise > 0
            ? `${formatINR(data.balance.balanceDuePaise, { showDecimals: false })} still outstanding.`
            : 'This member is now fully paid up.',
      });

      onOpenChange(false);
    },

    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            {member.fullName} · {member.memberId}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          className="mt-4 space-y-4"
          noValidate
        >
          <div className="rounded-xl bg-muted/50 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Outstanding</span>
              <span className="tabular font-semibold">
                {formatINR(balanceDuePaise, { showDecimals: false })}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label required className="text-[13px]">
              Amount
            </Label>
            <Input
              inputMode="decimal"
              icon={<IndianRupee />}
              autoFocus
              error={Boolean(errors.amountRupees)}
              {...register('amountRupees', {
                required: 'Enter an amount',
                validate: (value) => {
                  const paise = rupeesToPaise(Number(value) || 0);
                  if (paise <= 0) return 'Amount must be greater than zero';
                  // The server enforces this too; catching it here saves a
                  // round trip and explains the limit in place.
                  if (paise > balanceDuePaise) {
                    return `Cannot exceed the outstanding ${formatINR(balanceDuePaise, { showDecimals: false })}`;
                  }
                  return true;
                },
              })}
            />
            {errors.amountRupees && (
              <p className="text-[12px] font-medium text-destructive">
                {errors.amountRupees.message}
              </p>
            )}

            {/* Quick amounts — most payments are either the full balance or
                a round figure of cash. */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[balanceDuePaise, 100_000, 200_000, 500_000]
                .filter((p, i, arr) => p <= balanceDuePaise && arr.indexOf(p) === i)
                .map((paise) => (
                  <button
                    key={paise}
                    type="button"
                    onClick={() =>
                      setValue('amountRupees', String(paiseToRupees(paise)), {
                        shouldValidate: true,
                      })
                    }
                    className="rounded-full border border-border px-2.5 py-1 text-[12px] transition-colors hover:bg-accent"
                  >
                    {formatINR(paise, { showDecimals: false })}
                  </button>
                ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label required className="text-[13px]">
              Payment mode
            </Label>
            <Select
              value={mode}
              onValueChange={(v) => setValue('mode', v as PaymentForm['mode'])}
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

          {/* A non-cash payment with no reference cannot be reconciled
              against the bank statement later. */}
          {mode !== 'CASH' && (
            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Transaction reference
              </Label>
              <Input
                placeholder="UPI transaction ID / auth code"
                error={Boolean(errors.reference)}
                {...register('reference', {
                  required: 'A reference is required for non-cash payments',
                })}
              />
              {errors.reference && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.reference.message}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[13px]">Notes</Label>
            <Input placeholder="Optional" {...register('notes')} />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
            <Checkbox
              checked={watch('sendSms')}
              onCheckedChange={(checked) =>
                setValue('sendSms', checked === true)
              }
            />
            <span className="text-muted-foreground">
              Send a receipt SMS to the member
            </span>
          </label>

          {amountPaise > 0 && (
            <>
              <Separator />
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Paying now</span>
                  <span className="tabular font-medium text-success">
                    {formatINR(amountPaise, { showDecimals: false })}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Balance after payment
                  </span>
                  <span
                    className={cn(
                      'tabular font-semibold',
                      remaining > 0 ? 'text-destructive' : 'text-success',
                    )}
                  >
                    {formatINR(remaining, { showDecimals: false })}
                  </span>
                </div>
              </div>
            </>
          )}

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
              loadingText="Recording…"
            >
              <Receipt />
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
