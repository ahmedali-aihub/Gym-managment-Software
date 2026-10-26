import { Role } from '@azf/shared';
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
const MembershipsPage = React.lazy(() =>
  import('@/features/memberships/memberships-page').then((m) => ({
    default: m.MembershipsPage,
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

const MANAGEMENT: Role[] = [Role.OWNER, Role.MANAGER];
const FRONT_DESK: Role[] = [Role.OWNER, Role.MANAGER, Role.RECEPTIONIST];

/**
 * Where each role starts. The dashboard's figures are management
 * information the API refuses to everyone else; the front desk works from
 * Check-in, and trainers — who cannot check members in — from the roster.
 */
function homePathFor(role: Role): string {
  if (MANAGEMENT.includes(role)) return '/dashboard';
  return role === Role.RECEPTIONIST ? '/check-in' : '/members';
}

/**
 * Keeps a role off pages whose data the API will refuse it, sending it to
 * its own home rather than a "Something went wrong" screen. The nav already
 * hides these links; this covers bookmarks, typed URLs, and the '/dashboard'
 * that every login and fallback redirect lands on.
 */
function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();

  if (user && !roles.includes(user.role)) {
    return <Navigate to={homePathFor(user.role)} replace />;
  }

  return <>{children}</>;
}

/** AuthProvider needs router context for navigation, so it wraps here. */
function Root({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

function lazyRoute(Component: React.ComponentType, roles?: Role[]) {
  const page = (
    <React.Suspense fallback={<RouteLoader />}>
      <Component />
    </React.Suspense>
  );

  return roles ? <RequireRole roles={roles}>{page}</RequireRole> : page;
}

/**
 * Opt in to React Router v7 behaviour now. Without these, every page logs a
 * deprecation warning, and the eventual upgrade would change behaviour all
 * at once. The app uses no loaders, actions or fetchers, so only
 * v7_relativeSplatPath could matter — and the one splat route redirects to
 * an absolute path. v7_startTransition is set on RouterProvider in main.tsx.
 */
const ROUTER_FUTURE_FLAGS = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

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
      { path: 'dashboard', element: lazyRoute(DashboardPage, MANAGEMENT) },
      { path: 'members', element: lazyRoute(MembersPage) },
      { path: 'members/new', element: lazyRoute(RegisterMemberPage, FRONT_DESK) },
      { path: 'members/import', element: lazyRoute(ImportPage, MANAGEMENT) },
      { path: 'members/:id', element: lazyRoute(MemberProfilePage) },
      { path: 'payments', element: lazyRoute(PaymentsPage) },
      { path: 'memberships', element: lazyRoute(MembershipsPage, FRONT_DESK) },
      { path: 'plans', element: lazyRoute(PlansPage, MANAGEMENT) },
      { path: 'check-in', element: lazyRoute(CheckInPage) },
      { path: 'messages', element: lazyRoute(MessagesPage) },
      { path: 'expenses', element: lazyRoute(ExpensesPage, MANAGEMENT) },
      { path: 'reports', element: lazyRoute(ReportsPage, MANAGEMENT) },
      { path: 'settings', element: lazyRoute(SettingsPage, MANAGEMENT) },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
], { future: ROUTER_FUTURE_FLAGS });
