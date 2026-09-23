import { Outlet } from 'react-router-dom';
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
