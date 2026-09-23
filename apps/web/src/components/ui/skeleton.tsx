import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Skeleton placeholder.
 *
 * Shaped like the content it replaces, so the layout does not jump when real
 * data arrives. A spinner tells you to wait; a skeleton tells you what is
 * coming — which makes the same wait feel shorter.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('shimmer rounded-md bg-muted', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
