import { Loader2 } from 'lucide-react';
import * as React from 'react';
import {
  Navigate,
  createBrowserRouter,
  useLocation,
} from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
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
  import('@/features/sms/messages-page').then((m) => ({
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
const LeadsPage = React.lazy(() =>
  import('@/features/leads/leads-page').then((m) => ({ default: m.LeadsPage })),
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
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageLoader />;

  if (!isAuthenticated) {
    // Remember where they were headed, so login can return them there.
    const next = encodeURIComponent(
      `${location.pathname}${location.search}`,
    );
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}

function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <FullPageLoader />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

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
      { path: 'members/:id', element: lazyRoute(MemberProfilePage) },
      { path: 'payments', element: lazyRoute(PaymentsPage) },
      { path: 'plans', element: lazyRoute(PlansPage) },
      { path: 'check-in', element: lazyRoute(CheckInPage) },
      { path: 'messages', element: lazyRoute(MessagesPage) },
      { path: 'leads', element: lazyRoute(LeadsPage) },
      { path: 'expenses', element: lazyRoute(ExpensesPage) },
      { path: 'reports', element: lazyRoute(ReportsPage) },
      { path: 'settings', element: lazyRoute(SettingsPage) },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);
