import * as React from 'react';
import {
  Outlet,
  useLocation,
  useNavigationType,
  useSearchParams,
} from 'react-router-dom';
import { DemoBanner } from '@/components/common/demo-banner';
import { ErrorBoundary } from '@/components/common/states';
import { CommandPalette } from './command-palette';
import { FloatingNav, MobileNavBar } from './floating-nav';

/**
 * Authenticated application shell.
 *
 * No sidebar, no topbar — one floating pill, over full-width content.
 *
 * The padding is what makes it work: top padding clears the floating nav, and
 * bottom padding clears the mobile bar. Without them, content slides under a
 * translucent surface and becomes unreadable at exactly the wrong moment.
 */
export function AppShell() {
  useScrollToTopOnNewPage();

  return (
    <div className="min-h-dvh bg-background">
      <FloatingNav />
      <MobileNavBar />

      {/* pt: nav height + breathing room. pb: mobile bar, sm and below. */}
      <main className="mx-auto max-w-[1440px] px-4 pb-28 pt-[92px] sm:px-6 sm:pb-12 lg:px-8">
        <DemoBanner />
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>

      <CommandPalette />
    </div>
  );
}

/**
 * A new page, or a new page of a list, starts at its top.
 *
 * Nothing did this before: the window kept its scroll across navigations, so
 * a tab switched to from halfway down the dashboard opened halfway down the
 * next page, and Next at the foot of the member list showed the foot of the
 * next page.
 *
 * Keyed on the path and `?page=` only. Filters also live in the URL, and
 * jumping to the top on every chip tap or keystroke in a search box would be
 * worse than the bug. Back and forward are left to the browser.
 */
function useScrollToTopOnNewPage() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const page = searchParams.get('page') ?? '';

  // Read through a ref: as an effect dependency, a filter's replace after a
  // push would count as a change and scroll the page on its own.
  const navigationType = useNavigationType();
  const navigationTypeRef = React.useRef(navigationType);
  navigationTypeRef.current = navigationType;

  React.useLayoutEffect(() => {
    // Instant, overriding the stylesheet's smooth scrolling: a new page
    // should open at its top, not glide there past the old one's rows.
    if (navigationTypeRef.current !== 'POP') {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }, [pathname, page]);
}
