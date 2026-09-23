import axios, {
  AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { installDemoAdapter } from './demo-mode';

/**
 * HTTP client with transparent access-token refresh.
 *
 * The access token lives in memory only — never localStorage. An XSS payload
 * can read localStorage; it cannot read a module-scoped variable nearly as
 * easily. The refresh token is an httpOnly cookie the browser sends
 * automatically and JavaScript cannot touch at all.
 *
 * The cost is that a page reload loses the access token, so the app performs
 * a silent refresh on boot. That is one extra request in exchange for
 * removing the most common token-theft path.
 */

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Where the API lives.
 *
 * Locally this stays '/api' and the Vite dev proxy forwards it, which keeps
 * the browser same-origin so the httpOnly refresh cookie behaves exactly as
 * it will in production.
 *
 * Deployed, the web app and the API are on DIFFERENT hosts and there is no
 * proxy — a relative '/api' would hit the static host and 404. VITE_API_URL
 * carries the absolute URL there.
 */
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Demo mode swaps the transport for an in-memory one. No-op unless
// VITE_DEMO_MODE=true in development; always off in a production build.
installDemoAdapter(api);

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/**
 * Single-flight refresh.
 *
 * When a token expires, every in-flight request fails at once. Without this
 * guard each would trigger its own refresh — and because refresh tokens
 * ROTATE server-side, the second one would present an already-spent token,
 * which the API correctly treats as theft and responds to by revoking every
 * session. The user gets logged out for loading a page too fast.
 *
 * So: the first 401 starts a refresh, everyone else awaits that same promise.
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  refreshPromise ??= (async () => {
    try {
      // Uses the `api` instance, not bare axios: a bare call would bypass the
      // demo adapter and hit the network.
      const response = await api.post<{
        success: boolean;
        data: { accessToken: string; expiresIn: number };
      }>('/auth/refresh', {});

      const token = response.data.data.accessToken;
      setAccessToken(token);
      return token;
    } finally {
      // Cleared whether it resolved or rejected, so a later failure can retry.
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** Fired when refresh fails, so the auth store can clear and redirect. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => {};

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined;

    const status = error.response?.status;
    const code = error.response?.data?.error?.code;

    const isExpiredToken =
      status === 401 && (code === 'TOKEN_EXPIRED' || code === 'UNAUTHORIZED');

    // Never try to refresh a failing refresh — that is an infinite loop.
    const isRefreshCall = original?.url?.includes('/auth/refresh');

    if (isExpiredToken && original && !original._retried && !isRefreshCall) {
      original._retried = true;

      try {
        const token = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        setAccessToken(null);
        onSessionExpired();
        return Promise.reject(error);
      }
    }

    // TOKEN_INVALID means the session was revoked server-side — refreshing
    // will not help, so clear immediately.
    if (status === 401 && code === 'TOKEN_INVALID' && !isRefreshCall) {
      setAccessToken(null);
      onSessionExpired();
    }

    return Promise.reject(error);
  },
);

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  requestId?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiPaginated<T> {
  success: true;
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Extract a message safe to show a user.
 *
 * Network failures get a plain-language explanation rather than axios's
 * "Network Error", which tells a receptionist nothing actionable.
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message;
    }
    if (error.code === 'ECONNABORTED') {
      return 'The request took too long. Please check your connection and try again.';
    }
    if (!error.response) {
      return 'Cannot reach the server. Please check your internet connection.';
    }
    if (error.response.status >= 500) {
      return 'Something went wrong on our end. Please try again in a moment.';
    }
  }

  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred.';
}

/** Field-level validation errors, for mapping onto React Hook Form. */
export function getFieldErrors(
  error: unknown,
): Record<string, string[]> | undefined {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.error?.details;
  }
  return undefined;
}

export function getErrorCode(error: unknown): string | undefined {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    return error.response?.data?.error?.code;
  }
  return undefined;
}
