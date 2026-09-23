import { animate, motion, useMotionValue } from 'framer-motion';
import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A draggable iOS-style segmented control.
 *
 * The same interaction as the nav bar, extracted so every filter in the app
 * behaves identically: grab the marker, slide it, release on an option. A
 * plain click still works, and so does the keyboard.
 *
 * WHY THE MARKER IS TWO LAYERS. One element cannot satisfy both
 * requirements, and each single-layer arrangement fails differently:
 *
 *  - Marker behind the labels: it slides under the text correctly, but can
 *    never be grabbed — the label on top swallows the pointerdown.
 *  - Marker on top carrying its own label: draggable, but the label leaves
 *    its slot, so the row shows a hole and the active label renders twice.
 *
 * So: an EMPTY lozenge at z-0 that travels behind the labels, plus a
 * transparent handle at z-30 above everything whose only job is to catch the
 * pointer. Both are driven by one motion value so they cannot drift apart.
 *
 * Selection changes ONLY ON RELEASE. Firing as the marker passes each option
 * would re-run whatever the filter drives — a query, a refetch, a chart
 * rebuild — once per option crossed, to reach one destination.
 */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shorter label for narrow screens; falls back to `label`. */
  shortLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

/** The spring every segmented movement uses, matching the nav bar. */
const SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 32,
  mass: 0.8,
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
  size = 'default',
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel: string;
  size?: 'default' | 'sm';
}) {
  const railRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [bounds, setBounds] = React.useState<
    Array<{ left: number; width: number }>
  >([]);
  const [dragging, setDragging] = React.useState(false);
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  const x = useMotionValue(0);
  const dragWidthRef = React.useRef<number | null>(null);
  // False until positioned once, so the marker does not fly in from x=0.
  const settledRef = React.useRef(false);

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  /**
   * Measure every option relative to the rail.
   *
   * Options are different widths ("Today" vs "This quarter"), and labels can
   * collapse at a breakpoint, so the DOM is the only reliable source.
   */
  React.useLayoutEffect(() => {
    function measure() {
      const rail = railRef.current;
      if (!rail) return;

      const railBox = rail.getBoundingClientRect();
      setBounds(
        itemRefs.current.slice(0, options.length).map((el) => {
          if (!el) return { left: 0, width: 0 };
          const box = el.getBoundingClientRect();
          return { left: box.left - railBox.left, width: box.width };
        }),
      );
    }

    measure();
    const observer = new ResizeObserver(measure);
    if (railRef.current) observer.observe(railRef.current);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [options.length]);

  // Park the marker whenever the value changes from outside a drag.
  React.useEffect(() => {
    if (dragging) return;
    const target = bounds[activeIndex];
    if (!target) return;

    if (settledRef.current) {
      void animate(x, target.left, SPRING);
    } else {
      x.set(target.left);
      settledRef.current = true;
    }
  }, [activeIndex, bounds, dragging, x]);

  /** Which option sits under a given marker position. */
  const indexAt = React.useCallback(
    (markerLeft: number) => {
      if (bounds.length === 0) return null;

      // Centres, not edges: an edge test flips early on a wide option and
      // late on a narrow one. Uses the frozen width so the reference point
      // does not move as the selection changes under the thumb.
      const width =
        dragWidthRef.current ?? bounds[activeIndex]?.width ?? 0;
      const centre = markerLeft + width / 2;

      let closest = 0;
      let smallest = Infinity;
      bounds.forEach((bound, index) => {
        const distance = Math.abs(bound.left + bound.width / 2 - centre);
        if (distance < smallest) {
          smallest = distance;
          closest = index;
        }
      });
      return closest;
    },
    [bounds, activeIndex],
  );

  // Limits are in the handle's own space — it is `absolute left-0`, so the
  // rail's left edge is already its origin.
  const dragLimits = React.useMemo(() => {
    if (bounds.length === 0) return { left: 0, right: 0 };
    const first = bounds[0]!;
    const last = bounds[bounds.length - 1]!;
    return {
      left: first.left,
      right: Math.max(first.left, last.left + last.width - first.width),
    };
  }, [bounds]);

  const activeBound = bounds[activeIndex];
  const markerWidth = dragging
    ? (dragWidthRef.current ?? activeBound?.width ?? 0)
    : (activeBound?.width ?? 0);

  const height = size === 'sm' ? 'h-7' : 'h-9';
  const textSize = size === 'sm' ? 'text-[12px]' : 'text-[13px]';
  const padding = size === 'sm' ? 'px-2.5' : 'px-3';

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted/40 p-1',
        className,
      )}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      <div ref={railRef} className="relative flex items-center gap-0.5">
        {/* The visible lozenge: empty, and behind every label. */}
        {activeBound && (
          <motion.div
            style={{ x, width: markerWidth }}
            animate={dragging ? { scale: 1.06 } : { scale: 1 }}
            transition={SPRING}
            className={cn(
              'pointer-events-none absolute left-0 top-0 z-0 rounded-full',
              'bg-primary shadow-soft',
              height,
            )}
          />
        )}

        {/* The transparent handle: catches the pointer, paints nothing. */}
        {activeBound && (
          <motion.div
            drag="x"
            dragConstraints={dragLimits}
            dragElastic={0}
            dragMomentum={false}
            style={{ x, width: markerWidth }}
            onDragStart={() => {
              dragWidthRef.current = activeBound.width;
              setDragging(true);
            }}
            onDrag={() => setHoverIndex(indexAt(x.get()))}
            onDragEnd={() => {
              // Resolved BEFORE the ref is cleared: indexAt reads it to find
              // the marker's centre.
              const index = indexAt(x.get());
              const target = index !== null ? bounds[index] : undefined;
              const option = index !== null ? options[index] : undefined;

              dragWidthRef.current = null;
              setHoverIndex(null);
              setDragging(false);

              // Animated, not set: `animate` as a prop cannot drive a
              // controlled motion value, and setting it skips the spring.
              if (target) void animate(x, target.left, SPRING);
              if (option && option.value !== value) onChange(option.value);
            }}
            className={cn(
              'absolute left-0 top-0 z-30 rounded-full',
              height,
              dragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
            aria-hidden
          />
        )}

        {options.map((option, index) => {
          const active = index === activeIndex;
          const targeted = dragging && hoverIndex === index;
          const Icon = option.icon;

          return (
            <button
              key={option.value}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.value)}
              // Transparent to the pointer mid-drag, or crossing one steals
              // the capture and the gesture dies partway along the rail.
              style={dragging ? { pointerEvents: 'none' } : undefined}
              className={cn(
                'relative z-10 flex items-center gap-1.5 rounded-full font-medium',
                'transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                height,
                textSize,
                padding,
                // The lozenge is BEHIND the label, so the active option is
                // reading dark-on-cream. During a drag it has moved away and
                // dark text on the bar is invisible — so the colour reverts
                // for the duration of the gesture.
                (active && !dragging) || targeted
                  ? 'text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {Icon && <Icon className="size-3.5 shrink-0" />}
              {option.shortLabel ? (
                <>
                  <span className="hidden sm:inline">{option.label}</span>
                  <span className="sm:hidden">{option.shortLabel}</span>
                </>
              ) : (
                option.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
