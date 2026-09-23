import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Icon rendered inside the field, on the left. */
  icon?: React.ReactNode;
  /** Content on the right — a unit, a clear button, a validity tick. */
  suffix?: React.ReactNode;
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, suffix, error, ...props }, ref) => (
    <div className="relative w-full">
      {icon && (
        <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
          {icon}
        </div>
      )}
      <input
        type={type}
        className={cn(
          'flex h-11 w-full rounded-xl border border-input bg-background/70 px-3.5 py-2',
          'transition-all duration-200',
          'placeholder:text-muted-foreground',
          'focus-visible:border-ring/60 focus-visible:bg-background focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/15',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // 16px on mobile: anything smaller makes iOS Safari zoom on focus,
          // which throws the user out of the form layout mid-entry.
          'text-base sm:text-sm',
          icon && 'pl-10',
          suffix && 'pr-10',
          error && 'border-destructive focus-visible:ring-destructive',
          className,
        )}
        ref={ref}
        aria-invalid={error || undefined}
        {...props}
      />
      {suffix && (
        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
          {suffix}
        </div>
      )}
    </div>
  ),
);
Input.displayName = 'Input';

export { Input };
