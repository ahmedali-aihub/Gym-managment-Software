import { Loader2 } from 'lucide-react';
import * as React from 'react';
import {
  Navigate,
  createBrowserRouter,
  useLocation,
} from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { ChangePasswordRequiredPage } from '@/features/auth/change-password-page';
import { LoginPage } from '@/features/auth/login-page';

/**
 * Routes are lazy-loaded so the initial bundle carries only the shell and the
 * dashboard. A receptionist who never opens Reports should not pay to
 * download Recharts.
 */
const DashboardPage = React.lazy(() =>
  import('@/features/dashboard/dashboard-page').then((m) => ({
    default: m.DashboardPage,
  })),
);
const MembersPage = React.lazy(() =>
  import('@/features/members/members-page').then((m) => ({
    default: m.MembersPage,
  })),
);
const ImportPage = React.lazy(() =>
  import('@/features/import/import-page').then((m) => ({
    default: m.ImportPage,
  })),
);
const MemberProfilePage = React.lazy(() =>
  import('@/features/members/member-profile-page').then((m) => ({
    default: m.MemberProfilePage,
  })),
);
const RegisterMemberPage = React.lazy(() =>
  import('@/features/members/register-member-page').then((m) => ({
    default: m.RegisterMemberPage,
  })),
);
const PaymentsPage = React.lazy(() =>
  import('@/features/payments/payments-page').then((m) => ({
    default: m.PaymentsPage,
  })),
);
const PlansPage = React.lazy(() =>
  import('@/features/plans/plans-page').then((m) => ({ default: m.PlansPage })),
);
const MessagesPage = React.lazy(() =>
  import('@/features/messages/messages-page').then((m) => ({
    default: m.MessagesPage,
  })),
);
const CheckInPage = React.lazy(() =>
  import('@/features/attendance/check-in-page').then((m) => ({
    default: m.CheckInPage,
  })),
);
const ExpensesPage = React.lazy(() =>
  import('@/features/expenses/expenses-page').then((m) => ({
    default: m.ExpensesPage,
  })),
);
const ReportsPage = React.lazy(() =>
  import('@/features/reports/reports-page').then((m) => ({
    default: m.ReportsPage,
  })),
);
const SettingsPage = React.lazy(() =>
  import('@/features/settings/settings-page').then((m) => ({
    default: m.SettingsPage,
  })),
);

function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function RouteLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Gate for authenticated routes.
 *
 * While the boot-time silent refresh is in flight, render a loader rather
 * than redirecting — otherwise a signed-in user sees the login screen flash
 * on every page reload.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageLoader />;

  if (!isAuthenticated) {
    // Remember where they were headed, so login can return them there.
    const next = encodeURIComponent(
      `${location.pathname}${location.search}`,
    );
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Set administratively, never by the client — see change-password-page.tsx.
  // The redirect here is a convenience; the server enforces the same rule on
  // every request regardless of whether this ever renders.
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password-required" replace />;
  }

  return <>{children}</>;
}

function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <FullPageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

/**
 * Guards /change-password-required specifically: must be signed in (an
 * anonymous visitor has no password to change), but — unlike RequireAuth —
 * does NOT redirect away for mustChangePassword, since this is where that
 * redirect lands. Once the flag clears, there is nothing left to do here, so
 * it sends the user on rather than showing a pointless form.
 */
function RequireForcedChange({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) return <FullPageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user?.mustChangePassword) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

/** AuthProvider needs router context for navigation, so it wraps here. */
function Root({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function lazyRoute(Component: React.ComponentType) {
  return (
    <React.Suspense fallback={<RouteLoader />}>
      <Component />
    </React.Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: (
      <Root>
        <RedirectIfAuthenticated>
          <LoginPage />
        </RedirectIfAuthenticated>
      </Root>
    ),
  },
  {
    path: '/change-password-required',
    element: (
      <Root>
        <RequireForcedChange>
          <ChangePasswordRequiredPage />
        </RequireForcedChange>
      </Root>
    ),
  },
  {
    path: '/',
    element: (
      <Root>
        <RequireAuth>
          <AppShell />
        </RequireAuth>
      </Root>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: lazyRoute(DashboardPage) },
      { path: 'members', element: lazyRoute(MembersPage) },
      { path: 'members/new', element: lazyRoute(RegisterMemberPage) },
      { path: 'members/import', element: lazyRoute(ImportPage) },
      { path: 'members/:id', element: lazyRoute(MemberProfilePage) },
      { path: 'payments', element: lazyRoute(PaymentsPage) },
      { path: 'plans', element: lazyRoute(PlansPage) },
      { path: 'check-in', element: lazyRoute(CheckInPage) },
      { path: 'messages', element: lazyRoute(MessagesPage) },
      { path: 'expenses', element: lazyRoute(ExpensesPage) },
      { path: 'reports', element: lazyRoute(ReportsPage) },
      { path: 'settings', element: lazyRoute(SettingsPage) },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);
