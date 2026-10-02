import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, type ChangePasswordInput } from '@azf/shared';
import { motion } from 'framer-motion';
import { Eye, EyeOff, KeyRound, Lock, ShieldAlert } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from './auth-context';
import { api, getErrorMessage } from '@/lib/api-client';

/**
 * Forced password change.
 *
 * Reached only when the server says `mustChangePassword` is true — set
 * administratively for every account whose password hash was exposed while
 * Row-Level Security was disabled on every table (see SECURITY-NOTES.md).
 * The server enforces this independently of this page ever rendering:
 * every other endpoint refuses the request with PASSWORD_CHANGE_REQUIRED
 * until the change actually succeeds, so there is no way to click past this
 * screen and keep using the app on the old password.
 *
 * A successful change revokes every existing session (the API does this),
 * so the user signs in again afterwards rather than continuing seamlessly —
 * that is intentional: the whole point is a fresh, private credential.
 */
export function ChangePasswordRequiredPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: ChangePasswordInput) {
    try {
      await api.post('/auth/change-password', values);
      toast.success('Password changed. Please sign in again.');
      // The API already revoked every session as part of the change; this
      // just clears the client's own state to match.
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      const message = getErrorMessage(error);
      setError('currentPassword', { message });
      toast.error(message);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        className="pointer-events-none absolute left-1/2 top-0 size-[46rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-warning/[0.07] blur-[130px]"
        aria-hidden
      />
      <div className="grid-pattern pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <motion.div
        className="relative w-full max-w-[400px]"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-warning/10 text-warning">
            <ShieldAlert className="size-7" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold tracking-tight">
            Set a new password
          </h1>
          <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
            For your security, this account needs a new password before you
            can continue.
          </p>
        </div>

        <div className="titanium rounded-2xl border border-border/60 p-7">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="currentPassword" required className="text-[13px]">
                Current password
              </Label>
              <Input
                id="currentPassword"
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                autoFocus
                placeholder="Your existing password"
                icon={<Lock />}
                error={Boolean(errors.currentPassword)}
                aria-describedby={
                  errors.currentPassword ? 'current-password-error' : undefined
                }
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="pointer-events-auto rounded p-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showCurrent ? <EyeOff /> : <Eye />}
                  </button>
                }
                {...register('currentPassword')}
              />
              {errors.currentPassword && (
                <FieldError id="current-password-error">
                  {errors.currentPassword.message}
                </FieldError>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword" required className="text-[13px]">
                New password
              </Label>
              <Input
                id="newPassword"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                icon={<KeyRound />}
                error={Boolean(errors.newPassword)}
                aria-describedby={
                  errors.newPassword ? 'new-password-error' : undefined
                }
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="pointer-events-auto rounded p-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showNew ? <EyeOff /> : <Eye />}
                  </button>
                }
                {...register('newPassword')}
              />
              {errors.newPassword && (
                <FieldError id="new-password-error">
                  {errors.newPassword.message}
                </FieldError>
              )}
              <p className="text-[11px] text-muted-foreground">
                Needs an uppercase letter, a lowercase letter and a number.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" required className="text-[13px]">
                Confirm new password
              </Label>
              <Input
                id="confirmPassword"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Type it again"
                icon={<KeyRound />}
                error={Boolean(errors.confirmPassword)}
                aria-describedby={
                  errors.confirmPassword ? 'confirm-password-error' : undefined
                }
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <FieldError id="confirm-password-error">
                  {errors.confirmPassword.message}
                </FieldError>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full"
              loading={isSubmitting}
              loadingText="Changing password…"
            >
              Change password
            </Button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-[12px] font-medium text-destructive">
      {children}
    </p>
  );
}
