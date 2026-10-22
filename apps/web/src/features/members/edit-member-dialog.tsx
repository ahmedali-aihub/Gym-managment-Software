import {
  GENDER_LABELS,
  isDobRecorded,
  toDateInputValue,
  type Gender,
} from '@azf/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PhotoCapture } from '@/components/common/photo-capture';
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

export interface EditableMember {
  id: string;
  memberId: string;
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string;
  gender: string;
  city: string;
  addressLine1: string | null;
  pincode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  medicalNotes: string | null;
}

interface EditForm {
  fullName: string;
  phone: string;
  email: string;
  dateOfBirth: string;
  gender: Gender | '';
  addressLine1: string;
  pincode: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelation: string;
  medicalNotes: string;
}

/** API error paths that don't share a name with their form field. */
const FIELD_FOR_PATH: Record<string, keyof EditForm> = {
  'address.line1': 'addressLine1',
  'address.pincode': 'pincode',
  'emergencyContact.name': 'emergencyName',
  'emergencyContact.phone': 'emergencyPhone',
  'emergencyContact.relation': 'emergencyRelation',
};

function toForm(member: EditableMember): EditForm {
  return {
    fullName: member.fullName,
    phone: member.phone,
    email: member.email ?? '',
    // The 1900 placeholder means "never captured" — show an empty field,
    // not a date nobody entered.
    dateOfBirth: isDobRecorded(member.dateOfBirth)
      ? toDateInputValue(member.dateOfBirth)
      : '',
    gender: (member.gender as Gender) || '',
    addressLine1: member.addressLine1 ?? '',
    pincode: member.pincode ?? '',
    emergencyName: member.emergencyContactName ?? '',
    emergencyPhone: member.emergencyContactPhone ?? '',
    emergencyRelation: member.emergencyContactRelation ?? '',
    medicalNotes: member.medicalNotes ?? '',
  };
}

/**
 * Correct a member's details after registration.
 *
 * Sends only the fields that were changed. Imported records can hold values
 * today's rules reject — a 9-digit phone from the old software, say — and
 * resending those untouched would refuse a save that only fixed the name.
 * Membership and payment state are not here; they have their own audited
 * actions on the profile.
 */
export function EditMemberDialog({
  open,
  onOpenChange,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: EditableMember;
}) {
  const queryClient = useQueryClient();
  const [photo, setPhoto] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, dirtyFields },
  } = useForm<EditForm>({ defaultValues: toForm(member) });

  // Start from the saved record every time the dialog opens, so an
  // abandoned edit never leaks into the next one. Only on opening: a
  // background refetch of the profile must not wipe an edit in progress.
  React.useEffect(() => {
    if (open) {
      reset(toForm(member));
      setPhoto(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      await api.patch(`/members/${member.id}`, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['member', member.id] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      toast.success('Details saved');
      onOpenChange(false);
    },
    onError: (error) => {
      const fields = getFieldErrors(error);
      if (fields) {
        for (const [path, messages] of Object.entries(fields)) {
          const field = FIELD_FOR_PATH[path] ?? (path as keyof EditForm);
          if (messages[0]) setError(field, { message: messages[0] });
        }
      }
      toast.error(getErrorMessage(error));
    },
  });

  function onSubmit(values: EditForm) {
    const payload: Record<string, unknown> = {};

    if (dirtyFields.fullName) payload.fullName = values.fullName.trim();
    if (dirtyFields.phone) payload.phone = values.phone.trim();
    // An emptied field is sent as '' — the API reads that as "remove".
    if (dirtyFields.email) payload.email = values.email.trim();
    if (dirtyFields.dateOfBirth && values.dateOfBirth) {
      payload.dateOfBirth = values.dateOfBirth;
    }
    if (dirtyFields.gender && values.gender) payload.gender = values.gender;
    if (dirtyFields.addressLine1 || dirtyFields.pincode) {
      payload.address = {
        line1: values.addressLine1.trim() || undefined,
        pincode: values.pincode.trim() || undefined,
        // The API fills in its default city when none is given; keep theirs.
        city: member.city,
      };
    }
    if (
      (dirtyFields.emergencyName ||
        dirtyFields.emergencyPhone ||
        dirtyFields.emergencyRelation) &&
      values.emergencyName.trim()
    ) {
      payload.emergencyContact = {
        name: values.emergencyName.trim(),
        phone: values.emergencyPhone.trim(),
        relation: values.emergencyRelation.trim() || 'Family',
      };
    }
    if (dirtyFields.medicalNotes) {
      payload.medicalNotes = values.medicalNotes.trim();
    }
    if (photo) payload.photoDataUrl = photo;

    if (Object.keys(payload).length === 0) {
      onOpenChange(false);
      return;
    }

    mutation.mutate(payload);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            {member.fullName} · {member.memberId}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-4 space-y-5"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.fullName?.message}>
              <Input
                error={Boolean(errors.fullName)}
                {...register('fullName', {
                  required: 'Name is required',
                  minLength: { value: 2, message: 'Name is too short' },
                })}
              />
            </Field>

            <Field label="Phone" required error={errors.phone?.message}>
              <Input
                inputMode="numeric"
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

            <Field label="Date of birth" error={errors.dateOfBirth?.message}>
              <Input
                type="date"
                max={toDateInputValue(new Date())}
                error={Boolean(errors.dateOfBirth)}
                {...register('dateOfBirth')}
              />
            </Field>

            <Field label="Gender" error={errors.gender?.message}>
              <Select
                value={watch('gender')}
                onValueChange={(v) =>
                  setValue('gender', v as Gender, { shouldDirty: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GENDER_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="PIN code" error={errors.pincode?.message}>
              <Input
                inputMode="numeric"
                placeholder="500028"
                error={Boolean(errors.pincode)}
                {...register('pincode')}
              />
            </Field>

            <Field
              label="Address"
              error={errors.addressLine1?.message}
              className="sm:col-span-2"
            >
              <Input
                placeholder="Flat, street, area"
                {...register('addressLine1')}
              />
            </Field>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Emergency contact" error={errors.emergencyName?.message}>
              <Input placeholder="Name" {...register('emergencyName')} />
            </Field>
            <Field label="Their phone" error={errors.emergencyPhone?.message}>
              <Input
                inputMode="numeric"
                placeholder="98765 43210"
                {...register('emergencyPhone')}
              />
            </Field>
            <Field label="Relation" error={errors.emergencyRelation?.message}>
              <Input
                placeholder="Father, Spouse…"
                {...register('emergencyRelation')}
              />
            </Field>
          </div>

          <Field label="Medical notes" error={errors.medicalNotes?.message}>
            <Textarea
              rows={2}
              placeholder="Injuries or conditions trainers should know about"
              {...register('medicalNotes')}
            />
          </Field>

          <Separator />

          <div>
            <Label className="text-[13px]">New photo</Label>
            <p className="mb-2.5 mt-0.5 text-[11px] text-muted-foreground">
              Leave empty to keep the current one
            </p>
            <PhotoCapture value={photo} onChange={setPhoto} />
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
              <Save />
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
