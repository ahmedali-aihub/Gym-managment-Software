import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Button.
 *
 * `active:scale-[0.96]` is the detail that makes the interface feel physical:
 * a press produces immediate visual feedback before the network responds.
 * Combined with the loading state, a user always knows their click registered
 * — which is what stops double-submissions at a busy front desk.
 */
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap',
    'font-medium transition-all duration-200 ease-spring',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:scale-[0.96]',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        // Flat fills, no gradients. Depth comes from the surface beneath,
        // not from the control — the way iOS draws its buttons.
        default:
          'bg-primary text-primary-foreground hover:opacity-90',
        destructive:
          'bg-destructive text-destructive-foreground hover:opacity-90',
        outline:
          'border border-input bg-card/60 hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline active:scale-100',
        success: 'bg-success text-success-foreground hover:opacity-90',
        warning: 'bg-warning text-warning-foreground hover:opacity-90',
      },
      size: {
        // 44px is the minimum comfortable touch target on a phone; the
        // pill radius is what makes it read as a control rather than a box.
        default: 'h-10 rounded-full px-4 text-[13px] [&_svg]:size-4',
        sm: 'h-8 rounded-full px-3 text-[12px] [&_svg]:size-3.5',
        lg: 'h-11 rounded-full px-6 text-sm [&_svg]:size-4',
        xl: 'h-12 rounded-full px-7 text-[15px] [&_svg]:size-[18px]',
        icon: 'size-10 rounded-full [&_svg]:size-4',
        'icon-sm': 'size-8 rounded-full [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Shown beside the spinner, e.g. "Saving…". */
  loadingText?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      loadingText,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    // asChild renders someone else's element, so the spinner would fight it.
    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        // Tells screen readers the action is in progress, not stuck.
        aria-busy={loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
