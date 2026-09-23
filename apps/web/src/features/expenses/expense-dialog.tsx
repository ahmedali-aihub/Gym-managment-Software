import { paiseToRupees, rupeesToPaise } from '@azf/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, Save, Trash2 } from 'lucide-react';
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
import { Checkbox, Textarea } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, getErrorMessage } from '@/lib/api-client';
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseRow,
} from './expenses-page';

interface ExpenseForm {
  category: ExpenseCategory;
  title: string;
  amountRupees: string;
  incurredAt: string;
  paymentMode: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING';
  paidTo: string;
  notes: string;
  isRecurring: boolean;
}

/**
 * Record or edit an expense.
 *
 * `isRecurring` is the field that makes this sustainable. Marking rent as
 * recurring means next month it can be copied forward in one click rather
 * than retyped — and retyping is the reason small businesses abandon expense
 * tracking within two months.
 */
export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense?: ExpenseRow | null;
}) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(expense);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<ExpenseForm>();

  React.useEffect(() => {
    if (!open) return;

    reset({
      category: expense?.category ?? 'OTHER',
      title: expense?.title ?? '',
      amountRupees: expense ? String(paiseToRupees(expense.amountPaise)) : '',
      incurredAt: expense
        ? expense.incurredAt.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      paymentMode:
        (expense?.paymentMode as ExpenseForm['paymentMode']) ?? 'CASH',
      paidTo: expense?.paidTo ?? '',
      notes: expense?.notes ?? '',
      isRecurring: expense?.isRecurring ?? false,
    });
  }, [open, expense, reset]);

  const category = watch('category');
  const isRecurring = watch('isRecurring');

  const save = useMutation({
    mutationFn: async (values: ExpenseForm) => {
      const payload = {
        category: values.category,
        title: values.title,
        notes: values.notes || undefined,
        amountPaise: rupeesToPaise(Number(values.amountRupees) || 0),
        incurredAt: values.incurredAt,
        paymentMode: values.paymentMode,
        paidTo: values.paidTo || undefined,
        isRecurring: values.isRecurring,
      };

      if (expense) {
        await api.patch(`/expenses/${expense.id}`, payload);
      } else {
        await api.post('/expenses', payload);
      }
    },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-loss'] });

      toast.success(expense ? 'Expense updated' : 'Expense recorded');
      onOpenChange(false);
    },

    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.delete(`/expenses/${expense!.id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['profit-loss'] });

      toast.success('Expense removed');
      onOpenChange(false);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{expense ? 'Edit expense' : 'Add expense'}</DialogTitle>
          <DialogDescription>
            {expense
              ? 'Changes update the profit and loss immediately'
              : 'Record something the gym paid for'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((v) => save.mutate(v))}
          className="mt-4 space-y-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Category
              </Label>
              <Select
                value={category}
                onValueChange={(value) =>
                  setValue('category', value as ExpenseCategory)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Amount
              </Label>
              <Input
                inputMode="decimal"
                icon={<IndianRupee />}
                placeholder="0"
                error={Boolean(errors.amountRupees)}
                {...register('amountRupees', {
                  required: 'Amount is required',
                  validate: (value) =>
                    Number(value) > 0 || 'Amount must be greater than zero',
                })}
              />
              {errors.amountRupees && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.amountRupees.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label required className="text-[13px]">
                What was it for
              </Label>
              <Input
                placeholder="September rent, treadmill repair…"
                autoFocus
                error={Boolean(errors.title)}
                {...register('title', {
                  required: 'Describe what this was for',
                  minLength: { value: 2, message: 'Too short' },
                })}
              />
              {errors.title && (
                <p className="text-[12px] font-medium text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label required className="text-[13px]">
                Date paid
              </Label>
              {/* The date money left, not when it was typed in — a bill
                  recorded a week late still belongs to the week it was paid. */}
              <Input type="date" {...register('incurredAt')} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">Paid by</Label>
              <Select
                value={watch('paymentMode')}
                onValueChange={(value) =>
                  setValue('paymentMode', value as ExpenseForm['paymentMode'])
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

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">Paid to</Label>
              <Input
                placeholder="Landlord, electrician, supplier…"
                {...register('paidTo')}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">Notes</Label>
              <Textarea rows={2} placeholder="Optional" {...register('notes')} />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-info/[0.07] px-4 py-3">
            <Checkbox
              checked={isRecurring}
              onCheckedChange={(checked) =>
                setValue('isRecurring', checked === true)
              }
              className="mt-0.5"
            />
            <span className="text-[13px] leading-relaxed text-info">
              <strong className="font-semibold">This repeats monthly.</strong>{' '}
              Marked costs can be copied into next month in one click instead
              of being retyped.
            </span>
          </label>

          <DialogFooter className="sm:justify-between">
            {isEditing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => remove.mutate()}
                loading={remove.isPending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 />
                Delete
              </Button>
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={save.isPending}
                loadingText="Saving…"
              >
                <Save />
                {expense ? 'Save' : 'Add expense'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
