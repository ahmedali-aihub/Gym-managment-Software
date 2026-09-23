import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@azf/shared';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Lock, User } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import { getErrorMessage } from '@/lib/api-client';
import { isDemoMode } from '@/lib/demo-mode';
import { getRedirectTarget } from '@/lib/safe-redirect';
import { useAuth } from './auth-context';

/**
 * Sign-in screen.
 *
 * Centred single column rather than a split hero. The titanium palette is
 * quiet enough that a marketing panel would be the loudest thing on screen —
 * and this is an internal tool, where the people signing in already know what
 * it does. The restraint is the premium signal.
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: isDemoMode
      ? {
          identifier: 'owner@atozfitness.in',
          password: 'Password123',
          rememberMe: false,
        }
      : { identifier: '', password: '', rememberMe: false },
  });

  async function onSubmit(values: LoginInput) {
    try {
      const user = await login(values);
      toast.success(`Welcome back, ${user.fullName.split(' ')[0]}`);

      // Sanitised: the target comes from the URL and is attacker-controlled.
      navigate(getRedirectTarget(location.search), { replace: true });
    } catch (error) {
      const message = getErrorMessage(error);

      // Attached to the field so the message sits where the user is looking,
      // not only in a toast they may miss.
      setError('password', { message });
      toast.error(message);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Ambient warmth behind the card — barely visible, but it stops the
          background reading as flat paper. */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 size-[46rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/[0.07] blur-[130px]"
        aria-hidden
      />
      <div className="grid-pattern pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <motion.div
        className="relative w-full max-w-[400px]"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          {/* The logo already contains the gym's name, so repeating it as a
              heading would say the same thing twice. The locality line stays,
              because the artwork does not carry it. */}
          <img
            src="/logo.png"
            alt="A to Z Fitness Centre"
            className="h-24 w-auto drop-shadow-sm sm:h-28"
            width={512}
            height={512}
          />
          <p className="mt-3 text-[13px] text-muted-foreground">
            Mehdipatnam, Hyderabad
          </p>
        </div>

        {/* Card */}
        <div className="titanium rounded-2xl border border-border/60 p-7">
          <div className="mb-6">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Sign in
            </h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Enter your credentials to continue
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="identifier" required className="text-[13px]">
                Email or phone
              </Label>
              <Input
                id="identifier"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="you@atozfitness.in"
                icon={<User />}
                error={Boolean(errors.identifier)}
                aria-describedby={
                  errors.identifier ? 'identifier-error' : undefined
                }
                {...register('identifier')}
              />
              {errors.identifier && (
                <FieldError id="identifier-error">
                  {errors.identifier.message}
                </FieldError>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" required className="text-[13px]">
                Password
              </Label>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                icon={<Lock />}
                error={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : undefined}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="pointer-events-auto rounded p-0.5 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                }
                {...register('password')}
              />
              {errors.password && (
                <FieldError id="password-error">
                  {errors.password.message}
                </FieldError>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 pt-0.5 text-[13px]">
              <Checkbox {...register('rememberMe')} />
              <span className="text-muted-foreground">Keep me signed in</span>
            </label>

            <Button
              type="submit"
              size="lg"
              className="mt-2 w-full"
              loading={isSubmitting}
              loadingText="Signing in…"
            >
              Sign in
              <ArrowRight />
            </Button>
          </form>
        </div>

        {isDemoMode ? (
          <div className="mt-5 rounded-xl border border-warning/25 bg-warning/[0.07] px-4 py-3">
            <p className="text-[12px] font-semibold text-warning">Demo mode</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-warning/85">
              Credentials are pre-filled — just press Sign in. The data is
              sample data and no database is connected.
            </p>
          </div>
        ) : (
          <p className="mt-6 text-center text-[12px] text-muted-foreground">
            Trouble signing in? Contact your gym administrator.
          </p>
        )}
      </motion.div>
    </div>
  );
}

function FieldError({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <p id={id} role="alert" className="text-[12px] font-medium text-destructive">
      {children}
    </p>
  );
}
