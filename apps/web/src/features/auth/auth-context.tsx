import type { AuthUser, LoginInput, Role } from '@azf/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import {
  api,
  setAccessToken,
  setSessionExpiredHandler,
} from '@/lib/api-client';

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True until the silent refresh on boot settles. */
  isLoading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/**
 * Authentication state.
 *
 * The access token is held in memory by api-client, never in localStorage —
 * so a page reload has no token and must silently refresh using the httpOnly
 * cookie. That boot sequence is what `isLoading` guards: rendering routes
 * before it settles would flash the login screen at an already-signed-in user.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const queryClient = useQueryClient();

  const clearSession = React.useCallback(() => {
    setAccessToken(null);
    setUser(null);
    // Cached data belongs to the signed-out user; leaving it would leak
    // member details into the next session on a shared front-desk machine.
    queryClient.clear();
  }, [queryClient]);

  // Let the API client tear down the session when a refresh fails.
  React.useEffect(() => {
    setSessionExpiredHandler(clearSession);
  }, [clearSession]);

  // Silent restore on boot.
  React.useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const refresh = await api.post<{
          data: { accessToken: string };
        }>('/auth/refresh');

        if (cancelled) return;
        setAccessToken(refresh.data.data.accessToken);

        const me = await api.get<{ data: AuthUser }>('/auth/me');
        if (cancelled) return;
        setUser(me.data.data);
      } catch {
        // No valid session — the expected path for a signed-out visitor.
        if (!cancelled) clearSession();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = React.useCallback(
    async (input: LoginInput): Promise<AuthUser> => {
      const response = await api.post<{
        data: { user: AuthUser; accessToken: string; expiresIn: number };
      }>('/auth/login', input);

      const { user: loggedIn, accessToken } = response.data.data;
      setAccessToken(accessToken);
      setUser(loggedIn);
      return loggedIn;
    },
    [],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the server call fails, clear locally — the user asked to
      // leave, and the refresh token expires on its own.
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const hasRole = React.useCallback(
    (...roles: Role[]) => (user ? roles.includes(user.role) : false),
    [user],
  );

  const value = React.useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
      hasRole,
    }),
    [user, isLoading, login, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
