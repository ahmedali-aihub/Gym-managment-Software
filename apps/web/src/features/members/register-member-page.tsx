import {
  FITNESS_GOALS,
  FITNESS_GOAL_LABELS,
  GENDER_LABELS,
  Gender,
  calculateExpiryDate,
  formatDate,
  formatINR,
  rupeesToPaise,
  type FitnessGoal,
} from '@azf/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  IndianRupee,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  User,
} from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PhotoCapture } from '@/components/common/photo-capture';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator, Textarea } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, getErrorMessage, getFieldErrors } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface Plan {
  id: string;
  name: string;
  durationDays: number;
  pricePaise: number;
  joiningFeePaise: number;
}

interface RegisterForm {
  fullName: string;
  phone: string;
  planId: string;
  amountPaidRupees: string;
  paymentMode: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING';
  reference: string;
  sendWelcomeSms: boolean;

  // Everything below is optional and hidden by default.
  email: string;
  dateOfBirth: string;
  gender: Gender | '';
  addressLine1: string;
  pincode: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  medicalNotes: string;
  startDate: string;
  discountRupees: string;
  discountReason: string;
}

/**
 * Member registration.
 *
 * ONE page, not three steps. A receptionist with a member standing at the
 * desk needs four things — name, phone, plan, money — and everything else is
 * detail that can be filled in later from the profile.
 *
 * The earlier three-step wizard forced a walk through address and emergency
 * contact before the plan could even be picked. That is the wrong shape for
 * a counter transaction: it optimises for completeness of the record over
 * speed of the queue, when the member is the one waiting.
 *
 * Optional sections collapse behind a single toggle, so nothing is lost —
 * it is simply not in the way.
 */
export function RegisterMemberPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [photo, setPhoto] = React.useState<string | null>(null);
  const [goals, setGoals] = React.useState<FitnessGoal[]>([]);
  const [showMore, setShowMore] = React.useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<RegisterForm>({
    defaultValues: {
      fullName: '',
      phone: '',
      planId: '',
      amountPaidRupees: '',
      paymentMode: 'CASH',
      reference: '',
      sendWelcomeSms: false,
      email: '',
      dateOfBirth: '',
      gender: '',
      addressLine1: '',
      pincode: '',
      emergencyName: '',
      emergencyPhone: '',
      emergencyRelation: '',
      medicalNotes: '',
      startDate: new Date().toISOString().slice(0, 10),
      discountRupees: '',
      discountReason: '',
    },
  });

  const { data: plans } = useQuery({
    queryKey: ['plans-active'],
    queryFn: async () => {
      const response = await api.get<{ data: Plan[] }>('/plans/active');
      return response.data.data;
    },
  });

  const selectedPlanId = watch('planId');
  const startDate = watch('startDate');
  const discountRupees = watch('discountRupees');
  const amountPaidRupees = watch('amountPaidRupees');
  const paymentMode = watch('paymentMode');

  const selectedPlan = plans?.find((p) => p.id === selectedPlanId);

  /**
   * Live bill, mirroring the server's calculateBill(). The server stays the
   * authority — this is a preview so the desk can quote a figure aloud.
   */
  const bill = React.useMemo(() => {
    if (!selectedPlan) return null;

    const subtotal = selectedPlan.pricePaise + selectedPlan.joiningFeePaise;
    const discount = Math.min(
      rupeesToPaise(Number(discountRupees) || 0),
      subtotal,
    );
    const total = subtotal - discount;
    const paid = rupeesToPaise(Number(amountPaidRupees) || 0);

    return {
      subtotal,
      discount,
      total,
      paid,
      balance: Math.max(0, total - paid),
      expiryDate: calculateExpiryDate(
        new Date(startDate || Date.now()),
        selectedPlan.durationDays,
      ),
    };
  }, [selectedPlan, discountRupees, amountPaidRupees, startDate]);

  // Selecting a plan prefills the full amount — the common case is paying in
  // full, and a prefilled figure is faster to clear than to type.
  React.useEffect(() => {
    if (selectedPlan && !amountPaidRupees) {
      const total =
        (selectedPlan.pricePaise + selectedPlan.joiningFeePaise) / 100;
      setValue('amountPaidRupees', String(total));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId]);

  const mutation = useMutation({
    mutationFn: async (values: RegisterForm) => {
      const response = await api.post<{
        data: { member: { id: string; memberId: string } };
      }>('/members', {
        fullName: values.fullName,
        phone: values.phone,
        email: values.email || undefined,
        // The API requires a DOB; default to a placeholder adult date when
        // the desk skipped it, and let staff correct it from the profile.
        dateOfBirth: values.dateOfBirth || '1995-01-01',
        gender: values.gender || Gender.MALE,
        photoDataUrl: photo ?? undefined,
        address: values.addressLine1
          ? {
              line1: values.addressLine1,
              city: 'Hyderabad',
              state: 'Telangana',
              pincode: values.pincode || undefined,
            }
          : undefined,
        emergencyContact: values.emergencyName
          ? {
              name: values.emergencyName,
              phone: values.emergencyPhone,
              relation: values.emergencyRelation || 'Family',
            }
          : undefined,
        goals,
        medicalNotes: values.medicalNotes || undefined,
        planId: values.planId,
        startDate: values.startDate,
        payment: {
          amountPaid: rupeesToPaise(Number(values.amountPaidRupees) || 0),
          mode: values.paymentMode,
          discountAmount: rupeesToPaise(Number(values.discountRupees) || 0),
          discountReason: values.discountReason || undefined,
          joiningFee: selectedPlan?.joiningFeePaise ?? 0,
          reference: values.reference || undefined,
        },
        sendWelcomeSms: values.sendWelcomeSms,
      });

      return response.data.data;
    },

    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['member-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
      void queryClient.invalidateQueries({ queryKey: ['today-collection'] });

      toast.success(`${data.member.memberId} registered`, {
        description: 'Welcome SMS queued.',
      });

      navigate(`/members/${data.member.id}`);
    },

    onError: (error) => {
      const fields = getFieldErrors(error);

      if (fields) {
        for (const [path, messages] of Object.entries(fields)) {
          const key = path.split('.').pop() as keyof RegisterForm;
          if (key && messages[0]) {
            setError(key, { message: messages[0] });
            // An error in a collapsed section would otherwise be invisible.
            setShowMore(true);
          }
        }
      }

      toast.error(getErrorMessage(error));
    },
  });

  function toggleGoal(goal: FitnessGoal) {
    setGoals((current) =>
      current.includes(goal)
        ? current.filter((g) => g !== goal)
        : current.length >= 4
          ? current
          : [...current, goal],
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate('/members')}
          aria-label="Back to members"
        >
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            New member
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Four fields to register. Details can wait.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="space-y-5"
        noValidate
      >
        {/* ── The essentials ──────────────────────────────────────────── */}
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.fullName?.message}>
                <Input
                  icon={<User />}
                  placeholder="Rahul Sharma"
                  autoFocus
                  error={Boolean(errors.fullName)}
                  {...register('fullName', {
                    required: 'Name is required',
                    minLength: { value: 2, message: 'Name is too short' },
                  })}
                />
              </Field>

              <Field label="Phone" required error={errors.phone?.message}>
                <Input
                  icon={<Phone />}
                  inputMode="numeric"
                  placeholder="98765 43210"
                  error={Boolean(errors.phone)}
                  {...register('phone', {
                    required: 'Phone number is required',
                    pattern: {
                      value: /^(?:\+?91|0)?[6-9]\d{9}$/,
                      message: 'Enter a valid 10-digit mobile number',
                    },
                  })}
                />
              </Field>
            </div>

            {/* Plan picker */}
            <div>
              <Label required className="text-[13px]">
                Plan
              </Label>
              {errors.planId && (
                <p className="mt-1 text-[12px] font-medium text-destructive">
                  {errors.planId.message}
                </p>
              )}

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {plans?.map((plan) => {
                  const selected = plan.id === selectedPlanId;

                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() =>
                        setValue('planId', plan.id, { shouldValidate: true })
                      }
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-all',
                        selected
                          ? 'border-primary bg-primary/[0.06] ring-1 ring-primary'
                          : 'border-border hover:border-ring/40 hover:bg-accent/40',
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">
                          {plan.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {plan.durationDays} days
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular text-sm font-semibold">
                          {formatINR(plan.pricePaise, { showDecimals: false })}
                        </span>
                        {selected && (
                          <Check className="size-4 text-primary" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <input
                type="hidden"
                {...register('planId', { required: 'Select a plan' })}
              />
            </div>

            {/* Money */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount collected" required>
                <Input
                  inputMode="decimal"
                  icon={<IndianRupee />}
                  placeholder="0"
                  {...register('amountPaidRupees')}
                />
              </Field>

              <Field label="Mode" required>
                <Select
                  value={paymentMode}
                  onValueChange={(v) =>
                    setValue('paymentMode', v as RegisterForm['paymentMode'])
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
              </Field>

              {paymentMode !== 'CASH' && (
                <Field
                  label="Reference"
                  required
                  error={errors.reference?.message}
                  className="sm:col-span-2"
                >
                  <Input
                    placeholder="UPI transaction ID / auth code"
                    error={Boolean(errors.reference)}
                    {...register('reference', {
                      required:
                        'A reference is required for non-cash payments',
                    })}
                  />
                </Field>
              )}
            </div>

            {/* Live summary */}
            {bill && (
              <div className="rounded-xl bg-muted/50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
                  <span className="text-muted-foreground">
                    Valid until{' '}
                    <span className="font-medium text-foreground">
                      {formatDate(bill.expiryDate)}
                    </span>
                  </span>

                  <span
                    className={cn(
                      'tabular font-semibold',
                      bill.balance > 0 ? 'text-destructive' : 'text-success',
                    )}
                  >
                    {bill.balance > 0
                      ? `${formatINR(bill.balance, { showDecimals: false })} due`
                      : 'Fully paid'}
                  </span>
                </div>
              </div>
            )}

            {/* Email and WhatsApp only. SMS is not offered: Indian
                transactional SMS needs DLT registration to deliver at all,
                so a toggle here would promise something that goes nowhere.
                The API still accepts sendWelcomeSms if that ever changes. */}
            <div className="rounded-xl bg-muted/40 px-3.5 py-3">
              <p className="text-[13px] font-medium">
                This member will automatically receive
              </p>
              <ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground">
                <li className="flex items-center gap-2">
                  <MessageCircle className="size-3.5 shrink-0" />
                  WhatsApp with their member ID, plan and expiry date
                </li>
                <li className="flex items-center gap-2">
                  <Mail className="size-3.5 shrink-0" />
                  Email with the receipt PDF attached
                  <span className="text-muted-foreground/70">
                    (if an email address is given)
                  </span>
                </li>
              </ul>

            </div>
          </CardContent>
        </Card>

        {/* ── Optional details ────────────────────────────────────────── */}
        <Card>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/40 sm:px-6"
            aria-expanded={showMore}
          >
            <div>
              <span className="text-sm font-medium">More details</span>
              <span className="ml-2 text-[12px] text-muted-foreground">
                Photo, goals, address, emergency contact — all optional
              </span>
            </div>
            <ChevronDown
              className={cn(
                'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                showMore && 'rotate-180',
              )}
            />
          </button>

          <AnimatePresence initial={false}>
            {showMore && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <CardContent className="space-y-5 border-t border-border pt-5">
                  <PhotoCapture value={photo} onChange={setPhoto} />

                  <Separator />

                  <div>
                    <Label className="text-[13px]">Training focus</Label>
                    <p className="mb-2.5 mt-0.5 text-[11px] text-muted-foreground">
                      Used to filter members and plan classes
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {FITNESS_GOALS.map((goal) => {
                        const selected = goals.includes(goal);
                        return (
                          <button
                            key={goal}
                            type="button"
                            onClick={() => toggleGoal(goal)}
                            className={cn(
                              'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {FITNESS_GOAL_LABELS[goal]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Email" error={errors.email?.message}>
                      <Input
                        type="email"
                        placeholder="rahul@example.com"
                        error={Boolean(errors.email)}
                        {...register('email', {
                          pattern: {
                            value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                            message: 'Enter a valid email address',
                          },
                        })}
                      />
                    </Field>

                    <Field label="Date of birth">
                      <Input
                        type="date"
                        max={new Date().toISOString().slice(0, 10)}
                        {...register('dateOfBirth')}
                      />
                    </Field>

                    <Field label="Gender">
                      <Select
                        value={watch('gender')}
                        onValueChange={(v) => setValue('gender', v as Gender)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(GENDER_LABELS).map(
                            ([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="Membership starts">
                      <Input type="date" {...register('startDate')} />
                    </Field>

                    <Field label="Address" className="sm:col-span-2">
                      <Input
                        placeholder="Flat, street, area"
                        {...register('addressLine1')}
                      />
                    </Field>

                    <Field label="PIN code">
                      <Input placeholder="500028" {...register('pincode')} />
                    </Field>

                    <Field label="Discount">
                      <Input
                        inputMode="decimal"
                        icon={<IndianRupee />}
                        placeholder="0"
                        {...register('discountRupees')}
                      />
                    </Field>

                    {Number(discountRupees) > 0 && (
                      <Field
                        label="Discount reason"
                        required
                        error={errors.discountReason?.message}
                        className="sm:col-span-2"
                      >
                        <Input
                          placeholder="Festive offer, referral…"
                          error={Boolean(errors.discountReason)}
                          {...register('discountReason', {
                            required:
                              Number(discountRupees) > 0
                                ? 'A reason is required when a discount is applied'
                                : false,
                          })}
                        />
                      </Field>
                    )}
                  </div>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Emergency contact">
                      <Input placeholder="Name" {...register('emergencyName')} />
                    </Field>
                    <Field label="Their phone">
                      <Input
                        inputMode="numeric"
                        placeholder="98765 43210"
                        {...register('emergencyPhone')}
                      />
                    </Field>
                    <Field label="Relation">
                      <Input
                        placeholder="Father, Spouse…"
                        {...register('emergencyRelation')}
                      />
                    </Field>
                  </div>

                  <Field label="Medical notes">
                    <Textarea
                      rows={2}
                      placeholder="Injuries or conditions trainers should know about"
                      {...register('medicalNotes')}
                    />
                  </Field>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/members')}
          >
            Cancel
          </Button>

          <Button
            type="submit"
            size="lg"
            loading={mutation.isPending}
            loadingText="Registering…"
          >
            <Plus />
            Register member
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label required={required} className="text-[13px]">
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-[12px] font-medium text-destructive">{error}</p>
      )}
    </div>
  );
}
