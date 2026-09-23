import { Role } from '@azf/shared';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
} from 'framer-motion';
import {
  BarChart3,
  ChevronDown,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  ScanLine,
  Target,
  Wallet,
  MessageSquare,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  UserPlus,
  Users,
} from 'lucide-react';
import * as React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/members', label: 'Members', icon: Users },
  { to: '/check-in', label: 'Check-in', icon: ScanLine },
  { to: '/payments', label: 'Payments', icon: CreditCard },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/leads', label: 'Enquiries', icon: Target },
  {
    to: '/plans',
    label: 'Plans',
    icon: Dumbbell,
    roles: [Role.OWNER, Role.MANAGER],
  },
  {
    to: '/expenses',
    label: 'Expenses',
    icon: Wallet,
    roles: [Role.OWNER, Role.MANAGER],
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: BarChart3,
    roles: [Role.OWNER, Role.MANAGER],
  },
];

/**
 * Floating navigation pill.
 *
 * Replaces the sidebar entirely. It sits above the content, follows the user
 * across every screen, and never scrolls away — the whole interface reduces
 * to one object you always know where to find.
 *
 * Three details carry the effect:
 *
 *  • The active marker is a shared `layoutId`, so it physically SLIDES
 *    between items rather than cross-fading. The eye follows it, which is
 *    what makes the bar feel like one continuous object instead of a row of
 *    independent buttons.
 *
 *  • The pill shrinks and tightens its shadow on scroll, the way iOS large
 *    titles collapse. It is the same element throughout, so there is no
 *    swap or flicker at the threshold.
 *
 *  • Frosted glass with boosted saturation, so content colour bleeds through
 *    the blur instead of turning to mud.
 */
export function FloatingNav() {
  const { user, logout, hasRole } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    // Threshold rather than a continuous value: a pill that resizes on every
    // scroll frame is distracting, and it forces a layout recalculation on
    // each one.
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const items = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  );

  function openCommandPalette() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 sm:px-4 sm:pt-4">
      <motion.nav
        className={cn(
          'glass pointer-events-auto flex items-center gap-1 rounded-full',
          'transition-[padding,box-shadow] duration-300 ease-spring',
          scrolled ? 'px-2 py-1.5 shadow-pill' : 'px-2.5 py-2 shadow-medium',
        )}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        aria-label="Main navigation"
      >
        {/* Brand mark */}
        <button
          onClick={() => navigate('/dashboard')}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-full pl-1 pr-2.5 transition-opacity hover:opacity-70',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="A to Z Fitness — go to dashboard"
        >
          {/* The logo is navy-on-transparent, which disappears against the
              dark nav. A light disc behind it keeps the mark legible in both
              themes without altering the artwork itself. */}
          <span className="flex size-8 items-center justify-center rounded-full bg-white/95 p-0.5 shadow-sm dark:bg-white">
            <img
              src="/logo-64.png"
              alt=""
              className="size-full object-contain"
              width={64}
              height={64}
            />
          </span>
          {/* Shown from `xl` up, alongside the nav labels. Below that the
              logo alone identifies the gym. */}
          <span className="hidden whitespace-nowrap text-[13px] font-semibold tracking-tight xl:block">
            A to Z Fitness
          </span>
        </button>

        <span className="mx-0.5 h-5 w-px bg-nav-border" aria-hidden />

        {/* Primary links. Labels collapse to icons below `lg`, where the
            full set would not fit without wrapping. */}
        <NavRail items={items} />

        <span className="mx-0.5 h-5 w-px bg-nav-border" aria-hidden />

        {/* Search */}
        <button
          onClick={openCommandPalette}
          className={cn(
            'flex size-9 items-center justify-center rounded-full text-nav-foreground',
            'transition-colors hover:bg-accent hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          aria-label="Search (Ctrl+K)"
          title="Search  ⌘K"
        >
          <Search className="size-[17px]" />
        </button>

        {/* New member */}
        {hasRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST) && (
          <button
            onClick={() => navigate('/members/new')}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-medium text-primary-foreground',
              'transition-all hover:opacity-90 active:scale-[0.97]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <UserPlus className="size-[15px]" />
            <span className="hidden sm:inline">New</span>
          </button>
        )}

        {/* Account */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex items-center gap-1 rounded-full p-0.5 transition-colors hover:bg-accent',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label="Account menu"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold text-secondary-foreground">
                {user?.fullName.charAt(0).toUpperCase()}
              </span>
              <ChevronDown className="mr-0.5 hidden size-3 text-muted-foreground sm:block" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" sideOffset={10} className="w-60">
            <div className="px-2.5 py-2">
              <div className="truncate text-sm font-medium">
                {user?.fullName}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {user?.email}
              </div>
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) =>
                setTheme(value as 'light' | 'dark' | 'system')
              }
            >
              <DropdownMenuRadioItem value="light">
                <Sun className="mr-2 size-4" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon className="mr-2 size-4" />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor className="mr-2 size-4" />
                System
                <span className="ml-auto text-[10px] capitalize text-muted-foreground">
                  {resolvedTheme}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            {hasRole(Role.OWNER, Role.MANAGER) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate('/settings')}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem destructive onSelect={() => void logout()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </motion.nav>
    </div>
  );
}

/** The spring every nav movement uses, so nothing feels like a different object. */
const NAV_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 32,
  mass: 0.8,
};

/**
 * The nav rail — a draggable iOS-style segmented control.
 *
 * The marker is ONE element positioned over the row, not a child of the
 * active item. That is what makes it draggable: a marker living inside its
 * item can only ever animate between mount points, whereas this one is a
 * free object the pointer can pick up and carry.
 *
 * Geometry is measured rather than computed. Items have different widths
 * (labels appear only from `xl`, and "Dashboard" is wider than "Plans"), so
 * the only reliable source of each item's position is the DOM itself.
 *
 * The page changes ONLY ON RELEASE. Navigating live as the marker passed
 * each item meant a drag across the bar loaded every page it crossed — five
 * mounts, five data fetches, to reach one destination. Deferring to release
 * costs a highlight to show where the drop will land, and buys a gesture you
 * can change your mind during.
 */
function NavRail({ items }: { items: NavItem[] }) {
  const location = useLocation();
  const navigate = useNavigate();

  const railRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<Array<HTMLAnchorElement | null>>([]);
  const [bounds, setBounds] = React.useState<
    Array<{ left: number; width: number }>
  >([]);
  const [dragging, setDragging] = React.useState(false);
  // False until the pill has been positioned once; see the park effect.
  const settledRef = React.useRef(false);
  // Which item the marker is currently over. Purely a preview: with
  // navigation deferred to release, this is the only thing telling the eye
  // where the marker will land.
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);

  // One value drives both layers: the painted lozenge and the invisible
  // handle above it. Separate values would let them drift apart.
  const handleX = useMotionValue(0);

  const activeIndex = React.useMemo(() => {
    const found = items.findIndex((item) =>
      location.pathname.startsWith(item.to),
    );
    return found === -1 ? null : found;
  }, [items, location.pathname]);

  /**
   * Measure every item relative to the rail.
   *
   * Re-measured on resize AND when the item count changes: labels appear at
   * `xl`, which changes every width at once, and a role change adds or
   * removes items entirely. Stale geometry would put the marker over the
   * wrong item.
   */
  React.useLayoutEffect(() => {
    function measure() {
      const rail = railRef.current;
      if (!rail) return;

      const railBox = rail.getBoundingClientRect();
      const next = itemRefs.current.slice(0, items.length).map((el) => {
        if (!el) return { left: 0, width: 0 };
        const box = el.getBoundingClientRect();
        return { left: box.left - railBox.left, width: box.width };
      });
      setBounds(next);
    }

    measure();

    const observer = new ResizeObserver(measure);
    if (railRef.current) observer.observe(railRef.current);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [items.length]);

  // Park the marker on the active item whenever it changes from outside a
  // drag — a sidebar link, the back button, a redirect after login.
  React.useEffect(() => {
    if (dragging || activeIndex === null) return;
    const target = bounds[activeIndex];
    if (!target) return;

    // Jump without animating on the very first measure, so the pill does not
    // visibly fly in from x=0 on page load; animate every time after.
    if (settledRef.current) {
      void animate(handleX, target.left, NAV_SPRING);
    } else {
      handleX.set(target.left);
      settledRef.current = true;
    }
  }, [activeIndex, bounds, dragging, handleX]);

  /** Which item sits under a given marker position. */
  const indexAt = React.useCallback(
    (markerLeft: number) => {
      if (bounds.length === 0) return null;

      // Compare centres, not edges: an edge test would flip early on a wide
      // item and late on a narrow one. The centre is where the eye reads the
      // marker as "being". Uses the FROZEN width so the reference point does
      // not move as the selection changes under the thumb.
      const width =
        dragWidthRef.current ??
        (activeIndex !== null ? bounds[activeIndex]?.width : undefined) ??
        0;
      const markerCentre = markerLeft + width / 2;

      let closest = 0;
      let smallest = Infinity;

      bounds.forEach((bound, index) => {
        const distance = Math.abs(bound.left + bound.width / 2 - markerCentre);
        if (distance < smallest) {
          smallest = distance;
          closest = index;
        }
      });

      return closest;
    },
    [bounds, activeIndex],
  );

  // Constraints are computed from the FIRST item's width and never from the
  // travelling one, so they do not move mid-gesture either.
  /**
   * Travel limits, in the handle's OWN coordinate space.
   *
   * `dragConstraints` as a {left, right} object is measured from the
   * element's layout position, not from the rail. The handle is
   * `absolute left-0`, so its origin is already the rail's left edge and the
   * limits are plain offsets from there.
   *
   * Getting this wrong is subtle and nasty: passing the first item's `left`
   * as the lower bound clamped x into [317, 1150], so the pill could never
   * travel back to the first item and stayed stranded wherever it was
   * dropped — with the spring visibly running and going nowhere.
   */
  const dragLimits = React.useMemo(() => {
    if (bounds.length === 0) return { left: 0, right: 0 };
    const first = bounds[0]!;
    const last = bounds[bounds.length - 1]!;
    return {
      left: first.left,
      // Travel stops where the marker's right edge reaches the last item's.
      right: Math.max(first.left, last.left + last.width - first.width),
    };
  }, [bounds]);

  const activeBound = activeIndex !== null ? bounds[activeIndex] : undefined;
  const activeItem = activeIndex !== null ? items[activeIndex] : undefined;

  /**
   * The width the marker keeps for the whole gesture.
   *
   * Items are different widths, and the active item changes AS YOU DRAG.
   * Letting the marker resize mid-gesture moves its own centre, which shifts
   * the coordinate space the pointer is being measured against — the marker
   * drifts away from the thumb and lands one or two items short. Freezing
   * the width at drag start keeps the geometry stable, and it matches iOS,
   * where a segment does not resize while you are holding it.
   */
  const dragWidthRef = React.useRef<number | null>(null);
  const markerWidth = dragging
    ? (dragWidthRef.current ?? activeBound?.width ?? 0)
    : (activeBound?.width ?? 0);

  return (
    <div ref={railRef} className="relative flex items-center gap-0.5">
      {/* The travelling marker. One element for the whole rail, layered
          under the labels so text stays readable as it passes beneath. */}
      {activeBound && activeItem && (
        <motion.div
          style={{ x: handleX, width: markerWidth }}
          animate={dragging ? { scale: 1.06 } : { scale: 1 }}
          transition={NAV_SPRING}
          // TWO LAYERS, because one cannot satisfy both requirements.
          //
          // This is the visible lozenge, and it sits BEHIND every label
          // (z-0) so it slides underneath the text — it carries no content
          // of its own, which is what stopped the active label rendering
          // twice. Being underneath, it can never catch a pointer, so the
          // transparent handle below rides on top and does the dragging.
          className={cn(
            'pointer-events-none absolute left-0 top-0 z-0 h-9',
            'rounded-full bg-primary shadow-soft',
          )}
        />
      )}

      {/* The drag handle: an invisible copy of the marker, on top of
          everything, whose only job is to catch the pointer. Separating the
          grab target from the painted lozenge is what lets the lozenge live
          behind the labels while still being draggable. */}
      {activeBound && activeItem && (
        <motion.div
          drag="x"
          dragConstraints={dragLimits}
          dragElastic={0}
          dragMomentum={false}
          style={{ x: handleX, width: markerWidth }}
          // No `animate` for x: it is a controlled motion value via `style`,
          // and Framer will not drive a value it does not own — the two
          // silently fight and the pill stays where it was dropped. Every
          // move of handleX goes through animate() imperatively instead.
          onDragStart={() => {
            dragWidthRef.current = activeBound.width;
            setDragging(true);
          }}
          onDrag={() => {
            setHoverIndex(indexAt(handleX.get()));
          }}
          onDragEnd={() => {
            // Resolve the target BEFORE clearing dragWidthRef — indexAt
            // reads it to find the marker's centre, and a cleared ref makes
            // it fall back to the active item's width. Released just left of
            // home that shifted the centre a full item right, so the pill
            // "snapped" to the neighbour and sat there looking stranded.
            const index = indexAt(handleX.get());
            const target = index !== null ? bounds[index] : undefined;
            const item = index !== null ? items[index] : undefined;

            dragWidthRef.current = null;
            setHoverIndex(null);
            setDragging(false);

            // Animated, not set: `animate` on the element cannot drive a
            // controlled motion value, and setting it outright skips the
            // spring the whole gesture is built around.
            if (target) {
              void animate(handleX, target.left, NAV_SPRING);
            }

            if (item && index !== activeIndex) navigate(item.to);
          }}
          onClick={() => {
            // A click that never became a drag still behaves like a link —
            // the handle covers the active item, so without this the current
            // page would be unclickable.
            if (activeItem) navigate(activeItem.to);
          }}
          className={cn(
            'absolute left-0 top-0 z-30 h-9 rounded-full',
            dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          aria-hidden
        />
      )}

      {items.map((item, index) => (
        <NavPill
          key={item.to}
          item={item}
          dragging={dragging}
          targeted={dragging && hoverIndex === index}
          active={index === activeIndex}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
        />
      ))}
    </div>
  );
}

const NavPill = React.forwardRef<
  HTMLAnchorElement,
  {
    item: NavItem;
    dragging: boolean;
    targeted: boolean;
    active: boolean;
  }
>(function NavPill({ item, dragging, targeted, active }, ref) {
  const Icon = item.icon;

  return (
    <NavLink
      ref={ref}
      to={item.to}
      // Every item goes transparent to the pointer mid-drag: crossing one
      // would otherwise steal the capture and drop the gesture.
      style={dragging ? { pointerEvents: 'none' } : undefined}
      className={cn(
        'relative flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium',
        'transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        // Every item ALWAYS renders its own icon and label — nothing is ever
        // hidden, so the bar never shows a gap. The active one is lifted
        // above the marker (z-30 vs z-20) so its text reads against the
        // filled lozenge; the rest sit below it.
        //
        // The lozenge travels BEHIND the labels, so the active item reads
        // dark-on-cream only while the lozenge is actually under it. During
        // a drag it has moved away, and dark text on the dark bar would be
        // invisible — so the colour reverts for the duration of the gesture.
        active && !dragging
          ? 'z-10 text-primary-foreground'
          : 'z-10 text-nav-foreground hover:text-foreground',
        // The item the lozenge is currently under. It needs the dark
        // on-cream colour for the same reason the resting active item does —
        // the lozenge is behind it, and nav grey on cream is barely legible.
        // This is also the only cue for where the drop will land, since the
        // page no longer changes mid-drag.
        targeted && 'text-primary-foreground',
      )}
    >
      <Icon className="relative size-[16px] shrink-0" />
      {/* Labels appear only from `xl`. With nine items, showing
          them at `lg` overflows the viewport by ~250px. */}
      <span className="relative hidden whitespace-nowrap xl:inline">
        {item.label}
      </span>
    </NavLink>
  );
});

/**
 * Mobile bottom bar.
 *
 * Below `sm` the top pill keeps brand, search, new and account, while primary
 * navigation moves to the bottom of the screen — within thumb reach, which is
 * where a receptionist standing at the desk actually needs it.
 */
export function MobileNavBar() {
  const { user } = useAuth();

  const items = NAV_ITEMS.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role)),
  ).slice(0, 5);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-3 sm:hidden">
      <AnimatePresence>
        <motion.nav
          className="glass pointer-events-auto flex items-center gap-0.5 rounded-full p-1.5 shadow-pill"
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Primary navigation"
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'relative flex size-11 items-center justify-center rounded-full transition-colors',
                    isActive
                      ? 'text-primary-foreground'
                      : 'text-nav-foreground',
                  )
                }
                aria-label={item.label}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="mobile-nav-active"
                        className="absolute inset-0 rounded-full bg-primary"
                        transition={{
                          type: 'spring',
                          stiffness: 380,
                          damping: 32,
                        }}
                      />
                    )}
                    <Icon className="relative z-10 size-5" />
                  </>
                )}
              </NavLink>
            );
          })}
        </motion.nav>
      </AnimatePresence>
    </div>
  );
}
