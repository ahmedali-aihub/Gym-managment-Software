import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Count-up animation for a number.
 *
 * Animating the value rather than fading the card in draws the eye to the
 * figure itself, which is the thing the owner actually opened the page for.
 * The spring settles quickly — a long count-up stops being delightful and
 * starts being an obstacle between the user and the number.
 */
function useAnimatedNumber(value: number, enabled = true) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    stiffness: 90,
    damping: 20,
    mass: 0.6,
  });
  const rounded = useTransform(spring, (latest) => Math.round(latest));
  const [display, setDisplay] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) {
      setDisplay(value);
      return;
    }
    motionValue.set(value);
  }, [value, motionValue, enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    return rounded.on('change', (latest) => setDisplay(latest));
  }, [rounded, enabled]);

  return enabled ? display : value;
}

export interface KpiCardProps {
  label: string;
  value: number;
  /** Renders the animated number, e.g. as ₹1,50,000 or "142". */
  format: (value: number) => string;
  icon: React.ComponentType<{ className?: string }>;
  /** Percentage change vs. the previous period. null = no basis to compare. */
  change?: number | null;
  changeLabel?: string;
  /**
   * For metrics where a rise is bad (churn, dues). Flips the colour of the
   * trend indicator without changing the arrow direction.
   */
  invertTrend?: boolean;
  accent?: 'primary' | 'success' | 'warning' | 'destructive' | 'info';
  onClick?: () => void;
  loading?: boolean;
  /** Stagger index, so a row of cards animates in sequence. */
  index?: number;
}

const ACCENT_STYLES = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/12 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
} as const;

export function KpiCard({
  label,
  value,
  format,
  icon: Icon,
  change,
  changeLabel = 'vs last month',
  invertTrend = false,
  accent = 'primary',
  onClick,
  loading,
  index = 0,
}: KpiCardProps) {
  // Respect the OS reduced-motion setting: animating numbers is exactly the
  // kind of movement that triggers discomfort for some users.
  const prefersReducedMotion = React.useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // Changing the dashboard's period filter re-fetches under a brand new
  // React Query key, which reports loading even for figures — like total
  // members — that do not actually change with the period. `value` during
  // that window is the caller's fallback (`overview?.x ?? 0`), not a real
  // reading. Feeding that into the animation was the bug: once the real
  // value arrived and happened to match wherever the spring had already
  // settled (common, since most of these numbers ARE the same across
  // periods), setting it was a no-op — nothing changed, so the spring
  // never fired a 'change' event, and the displayed number stayed stuck at
  // the fallback 0 with no skeleton left to hide it. Holding the last real
  // value steady through a loading window — rather than resetting toward
  // the fallback and hoping a later update corrects it — means there is
  // always a next real value for the animation to actually move to.
  const lastRealValue = React.useRef(value);
  if (!loading) lastRealValue.current = value;

  const animated = useAnimatedNumber(
    loading ? lastRealValue.current : value,
    !loading && !prefersReducedMotion,
  );

  if (loading) return <KpiCardSkeleton />;

  const isPositive = change !== null && change !== undefined && change > 0;
  const isNegative = change !== null && change !== undefined && change < 0;
  const isGood = invertTrend ? isNegative : isPositive;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        delay: prefersReducedMotion ? 0 : index * 0.06,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="min-w-0"
    >
      <Card
        interactive={Boolean(onClick)}
        onClick={onClick}
        className="group relative h-full overflow-hidden p-4 sm:p-5"
        {...(onClick
          ? {
              role: 'button',
              tabIndex: 0,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onClick();
                }
              },
            }
          : {})}
      >
        {/* Accent wash, revealed on hover. */}
        <div
          className={cn(
            'pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100',
            ACCENT_STYLES[accent],
          )}
          aria-hidden
        />

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-muted-foreground sm:text-sm">
              {label}
            </p>

            <p className="tabular mt-2 font-display text-[22px] font-bold leading-none tracking-tight sm:text-[28px]">
              {format(animated)}
            </p>

            {change !== undefined && (
              <div className="mt-3 flex items-center gap-1.5">
                {change === null ? (
                  <span className="text-xs text-muted-foreground">
                    No prior data
                  </span>
                ) : (
                  <>
                    <span
                      className={cn(
                        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular',
                        change === 0
                          ? 'bg-muted text-muted-foreground'
                          : isGood
                            ? 'bg-success/12 text-success'
                            : 'bg-destructive/12 text-destructive',
                      )}
                    >
                      {change === 0 ? (
                        <Minus className="size-3" />
                      ) : isPositive ? (
                        <ArrowUpRight className="size-3" />
                      ) : (
                        <ArrowDownRight className="size-3" />
                      )}
                      {Math.abs(change).toFixed(1)}%
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {changeLabel}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Two cards share a phone's width; there the label carries it. */}
          <div
            className={cn(
              'hidden size-10 shrink-0 items-center justify-center rounded-xl sm:flex',
              ACCENT_STYLES[accent],
            )}
          >
            <Icon className="size-5" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

export function KpiCardSkeleton() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-4 w-20 sm:w-24" />
          <Skeleton className="h-6 w-16 sm:h-7 sm:w-32" />
        </div>
        <Skeleton className="hidden size-10 rounded-xl sm:block" />
      </div>
    </Card>
  );
}
