import { AlertCircle, RefreshCw, SearchX } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Empty, error and loading states.
 *
 * Every list and panel in the app uses these, so the experience of "nothing
 * here yet" is consistent and always offers a way forward. An empty state
 * that only says "No data" wastes the one moment the user is most receptive
 * to being told what to do next.
 */

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = SearchX,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-16 text-center',
        className,
      )}
    >
      <div className="relative mb-5">
        <div
          className="absolute inset-0 rounded-full bg-primary/10 blur-xl"
          aria-hidden
        />
        <div className="relative flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/50">
          <Icon className="size-6 text-muted-foreground" />
        </div>
      </div>

      <h3 className="font-display text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

export function ErrorState({
  error,
  onRetry,
  title = 'Something went wrong',
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-16 text-center',
        className,
      )}
      role="alert"
    >
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-destructive/20 bg-destructive/10">
        <AlertCircle className="size-6 text-destructive" />
      </div>

      <h3 className="font-display text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {getErrorMessage(error)}
      </p>

      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="mt-6">
          <RefreshCw />
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline error for a panel inside a page that otherwise loaded fine. */
export function InlineError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
      <AlertCircle className="size-4 shrink-0 text-destructive" />
      <p className="flex-1 text-sm text-destructive">{getErrorMessage(error)}</p>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/**
 * Page-level error boundary.
 *
 * A render error in one panel should not blank the whole application. React
 * has no hook equivalent for this, so it stays a class component.
 */
interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Render error:', error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <Card className="m-4">
          <ErrorState
            error={this.state.error}
            title="This section failed to load"
            onRetry={() => this.setState({ error: null })}
          />
        </Card>
      );
    }

    return this.props.children;
  }
}
