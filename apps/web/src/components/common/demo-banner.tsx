import { Info, X } from 'lucide-react';
import * as React from 'react';
import { isDemoMode } from '@/lib/demo-mode';
import { cn } from '@/lib/utils';

/**
 * Demo-mode notice.
 *
 * Styled as an inline card rather than a full-bleed bar: with a floating nav
 * there is no header edge for a banner to attach to, and a stripe across the
 * top would fight the pill for attention.
 *
 * Visible and unambiguous regardless — someone reviewing the UI must never
 * wonder whether the members on screen are real.
 */
export function DemoBanner() {
  const [dismissed, setDismissed] = React.useState(false);

  if (!isDemoMode || dismissed) return null;

  return (
    <div
      className={cn(
        'mb-6 flex items-center gap-3 rounded-xl px-4 py-3',
        'border border-warning/25 bg-warning/[0.07]',
      )}
      role="status"
    >
      <Info className="size-4 shrink-0 text-warning" />

      <p className="flex-1 text-[13px] leading-relaxed text-warning">
        <strong className="font-semibold">Demo mode.</strong>{' '}
        <span className="text-warning/85">
          Sample data, no database connected — nothing you change is saved.
        </span>
      </p>

      <button
        onClick={() => setDismissed(true)}
        className="rounded-md p-1 text-warning/70 transition-colors hover:bg-warning/10 hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
        aria-label="Dismiss demo notice"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
