import { formatINR } from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, User } from 'lucide-react';
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
import { Textarea } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, getErrorMessage } from '@/lib/api-client';
import { SOURCE_LABELS } from './leads-page';

interface Plan {
  id: string;
  name: string;
  pricePaise: number;
}

interface NewLeadForm {
  fullName: string;
  phone: string;
  email: string;
  source: string;
  interestedIn: string;
  quotedPlanId: string;
  notes: string;
  followUpAt: string;
}

/**
 * Record an enquiry.
 *
 * Two fields are genuinely required — a name and a phone number. Everything
 * else is optional, because an enquiry is usually taken while the person is
 * still standing at the desk, and a long form means it never gets recorded
 * at all.
 *
 * The follow-up date defaults to tomorrow rather than being left blank: an
 * enquiry with no next step is an enquiry nobody will ever call back.
 */
export function NewLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<NewLeadForm>();

  React.useEffect(() => {
    if (!open) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    reset({
      fullName: '',
      phone: '',
      email: '',
      source: 'WALK_IN',
      interestedIn: '',
      quotedPlanId: '',
      notes: '',
      followUpAt: tomorrow.toISOString().slice(0, 10),
    });
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: async (values: NewLeadForm) => {
      await api.post('/leads', {
        fullName: values.fullName,
        phone: values.phone,
        email: values.email || undefined,
        source: values.source,
        interestedIn: values.interestedIn || undefined,
        quotedPlanId: values.quotedPlanId || undefined,
        notes: values.notes || undefined,
        followUpAt: values.followUpAt || undefined,
      });
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['lead-stats'] });

      toast.success('Enquiry recorded', {
        description: 'It will appear in the follow-up list on the chosen date.',
      });
      onOpenChange(false);
    },

    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New enquiry</DialogTitle>
          <DialogDescription>
            Two fields to record. The rest can wait.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          className="mt-4 space-y-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Name
              </Label>
              <Input
                icon={<User />}
                placeholder="Rahul Sharma"
                autoFocus
                error={Boolean(errors.fullName)}
                {...register('fullName', {
                  required: 'Name is required',
                  minLength: { value: 2, message: 'Too short' },
                })}
              />
              {errors.fullName && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.fullName.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Phone
              </Label>
              <Input
                icon={<Phone />}
                inputMode="numeric"
                placeholder="98765 43210"
                error={Boolean(errors.phone)}
                {...register('phone', {
                  required: 'Phone number is required',
                  pattern: {
                    value: /^(?:\+?91|0)?[6-9]\d{9}$/,
                    message: 'Enter a valid mobile number',
                  },
                })}
              />
              {errors.phone && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.phone.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">How they found us</Label>
              <Select
                value={watch('source')}
                onValueChange={(value) => setValue('source', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Call back on</Label>
              <Input type="date" {...register('followUpAt')} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">Plan discussed</Label>
              <Select
                value={watch('quotedPlanId') || 'none'}
                onValueChange={(value) =>
                  setValue('quotedPlanId', value === 'none' ? '' : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="None yet" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None yet</SelectItem>
                  {plans?.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} ·{' '}
                      {formatINR(plan.pricePaise, { showDecimals: false })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">What they want</Label>
              <Input
                placeholder="Weight loss, evening batch…"
                {...register('interestedIn')}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">Notes</Label>
              <Textarea
                rows={2}
                placeholder="Anything worth remembering before calling back"
                {...register('notes')}
              />
            </div>
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
              loadingText="Saving…"
            >
              <Plus />
              Record enquiry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
