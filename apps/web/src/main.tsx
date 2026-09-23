import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
import { ChartAccentProvider } from '@/hooks/use-chart-accent';
import { ThemeProvider } from '@/hooks/use-theme';
import { router } from '@/routes';
import '@/styles/globals.css';

/**
 * Query defaults.
 *
 * `retry` deliberately skips 4xx: a 404 or a 403 will return the same answer
 * however many times it is asked, and retrying only delays the error state
 * the user needs to see.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response
          ?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Nested inside ThemeProvider: the accent swatches render in the
            current mode's step, so they need to read resolvedTheme. */}
        <ChartAccentProvider>
          <TooltipProvider delayDuration={300}>
            <RouterProvider router={router} />
            <Toaster
              position="top-right"
              richColors
              closeButton
            />
          </TooltipProvider>
        </ChartAccentProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
