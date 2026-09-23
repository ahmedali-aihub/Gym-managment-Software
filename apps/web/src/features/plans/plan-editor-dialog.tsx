import {
  PLAN_TYPE_DEFAULT_DAYS,
  PLAN_TYPE_LABELS,
  PlanType,
  formatINR,
  paiseToRupees,
  rupeesToPaise,
} from '@azf/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, Plus, Save, X } from 'lucide-react';
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
import { Separator, Switch, Textarea } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, getErrorMessage, getFieldErrors } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export interface EditablePlan {
  id: string;
  name: string;
  description: string | null;
  type: PlanType;
  durationDays: number;
  pricePaise: number;
  joiningFeePaise: number;
  maxFreezeDays: number;
  features: string[];
  isActive: boolean;
}

interface PlanForm {
  name: string;
  description: string;
  type: PlanType;
  durationDays: string;
  priceRupees: string;
  joiningFeeRupees: string;
  maxFreezeDays: string;
  isActive: boolean;
}

/**
 * Create or edit a membership plan.
 *
 * Price changes affect FUTURE purchases only — existing memberships copied
 * their price at the moment of purchase. The dialog says so explicitly when
 * editing, because "will this raise what my current members pay?" is the
 * first thing an owner wonders before touching a price.
 */
export function PlanEditorDialog({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new plan. */
  plan?: EditablePlan | null;
}) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(plan);

  const [features, setFeatures] = React.useState<string[]>([]);
  const [featureDraft, setFeatureDraft] = React.useState('');

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    setError,
    formState: { errors },
  } = useForm<PlanForm>();

  // Repopulate whenever the dialog opens or the target plan changes.
  React.useEffect(() => {
    if (!open) return;

    reset({
      name: plan?.name ?? '',
      description: plan?.description ?? '',
      type: plan?.type ?? PlanType.MONTHLY,
      durationDays: String(plan?.durationDays ?? 30),
      priceRupees: plan ? String(paiseToRupees(plan.pricePaise)) : '',
      joiningFeeRupees: plan
        ? String(paiseToRupees(plan.joiningFeePaise))
        : '0',
      maxFreezeDays: String(plan?.maxFreezeDays ?? 0),
      isActive: plan?.isActive ?? true,
    });

    setFeatures(plan?.features ?? []);
    setFeatureDraft('');
  }, [open, plan, reset]);

  const type = watch('type');
  const priceRupees = watch('priceRupees');
  const durationDays = watch('durationDays');

  // Picking a type prefills its conventional duration; a custom plan keeps
  // whatever was typed.
  React.useEffect(() => {
    if (!open || isEditing) return;
    if (type && type !== PlanType.CUSTOM) {
      setValue('durationDays', String(PLAN_TYPE_DEFAULT_DAYS[type]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  /** Per-day cost, so an owner can sanity-check pricing across plans. */
  const perDayPaise = React.useMemo(() => {
    const price = rupeesToPaise(Number(priceRupees) || 0);
    const days = Number(durationDays) || 0;
    return days > 0 ? Math.round(price / days) : 0;
  }, [priceRupees, durationDays]);

  const mutation = useMutation({
    mutationFn: async (values: PlanForm) => {
      const payload = {
        name: values.name,
        description: values.description || undefined,
        type: values.type,
        durationDays: Number(values.durationDays),
        pricePaise: rupeesToPaise(Number(values.priceRupees) || 0),
        joiningFeePaise: rupeesToPaise(Number(values.joiningFeeRupees) || 0),
        maxFreezeDays: Number(values.maxFreezeDays) || 0,
        features,
        isActive: values.isActive,
      };

      if (plan) {
        await api.patch(`/plans/${plan.id}`, payload);
      } else {
        await api.post('/plans', payload);
      }
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['plans'] });
      void queryClient.invalidateQueries({ queryKey: ['plans-active'] });
      void queryClient.invalidateQueries({ queryKey: ['plan-distribution'] });

      toast.success(plan ? 'Plan updated' : 'Plan created');
      onOpenChange(false);
    },

    onError: (error) => {
      const fields = getFieldErrors(error);
      if (fields) {
        for (const [path, messages] of Object.entries(fields)) {
          const key = path.split('.').pop() as keyof PlanForm;
          if (key && messages[0]) setError(key, { message: messages[0] });
        }
      }
      toast.error(getErrorMessage(error));
    },
  });

  function addFeature() {
    const value = featureDraft.trim();
    if (!value || features.includes(value)) return;
    setFeatures((current) => [...current, value]);
    setFeatureDraft('');
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit plan' : 'New plan'}</DialogTitle>
          <DialogDescription>
            {plan
              ? 'Changes apply to new purchases only'
              : 'Add a membership plan members can buy'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => mutation.mutate(v))}
          className="mt-4 space-y-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label required className="text-[13px]">
                Name
              </Label>
              <Input
                placeholder="Quarterly"
                autoFocus
                error={Boolean(errors.name)}
                {...register('name', {
                  required: 'Name is required',
                  minLength: { value: 2, message: 'Name is too short' },
                })}
              />
              {errors.name && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Type
              </Label>
              <Select
                value={type}
                onValueChange={(value) => setValue('type', value as PlanType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PLAN_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Duration (days)
              </Label>
              <Input
                inputMode="numeric"
                error={Boolean(errors.durationDays)}
                {...register('durationDays', {
                  required: 'Duration is required',
                  min: { value: 1, message: 'Must be at least 1 day' },
                })}
              />
              {errors.durationDays && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.durationDays.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Price
              </Label>
              <Input
                inputMode="decimal"
                icon={<IndianRupee />}
                placeholder="4000"
                error={Boolean(errors.priceRupees)}
                {...register('priceRupees', {
                  required: 'Price is required',
                })}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Joining fee</Label>
              <Input
                inputMode="decimal"
                icon={<IndianRupee />}
                placeholder="0"
                {...register('joiningFeeRupees')}
              />
              <p className="text-[11px] text-muted-foreground">
                Charged once, on first join
              </p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">Freeze days allowed</Label>
              <Input
                inputMode="numeric"
                placeholder="0"
                {...register('maxFreezeDays')}
              />
              <p className="text-[11px] text-muted-foreground">
                Days a member may pause. Frozen days extend the expiry date.
                Zero disables freezing on this plan.
              </p>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">Description</Label>
              <Textarea
                rows={2}
                placeholder="Three months, at a better rate than monthly."
                {...register('description')}
              />
            </div>
          </div>

          {/* Per-day cost */}
          {perDayPaise > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-2.5 text-[13px]">
              <span className="text-muted-foreground">Works out to</span>
              <span className="tabular font-medium">
                {formatINR(perDayPaise)} per day
              </span>
            </div>
          )}

          <Separator />

          {/* Features */}
          <div>
            <Label className="text-[13px]">What is included</Label>
            <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
              Shown on the plan card when staff pick a plan
            </p>

            <div className="flex gap-2">
              <Input
                value={featureDraft}
                onChange={(event) => setFeatureDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter would otherwise submit the whole form.
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addFeature();
                  }
                }}
                placeholder="Locker facility"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addFeature}
                disabled={!featureDraft.trim()}
              >
                <Plus />
              </Button>
            </div>

            {features.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {features.map((feature) => (
                  <span
                    key={feature}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[12px]"
                  >
                    {feature}
                    <button
                      type="button"
                      onClick={() =>
                        setFeatures((current) =>
                          current.filter((f) => f !== feature),
                        )
                      }
                      className="rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                      aria-label={`Remove ${feature}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="text-[13px] font-medium">Offered to members</span>
              <span className="block text-[11px] text-muted-foreground">
                Turn off to retire the plan without affecting existing members
              </span>
            </span>
            <Switch
              checked={watch('isActive')}
              onCheckedChange={(checked) => setValue('isActive', checked)}
            />
          </label>

          {isEditing && (
            <p
              className={cn(
                'rounded-xl bg-info/[0.08] px-4 py-2.5 text-[12px] leading-relaxed text-info',
              )}
            >
              Existing members keep the price they paid. A change here applies
              only to purchases made from now on.
            </p>
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
              loadingText="Saving…"
            >
              <Save />
              {plan ? 'Save changes' : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
