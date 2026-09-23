import { formatDate } from '@azf/shared';
import { CalendarRange, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface DateRange {
  /** Both in yyyy-MM-dd — the format <input type="date"> speaks. */
  from: string;
  to: string;
}

/**
 * Custom date range picker.
 *
 * Built on native `<input type="date">` rather than a calendar library. That
 * gives a real date picker, keyboard entry, and the mobile date wheel for
 * free, in the device's own locale — and adds nothing to the bundle.
 *
 * Values are held in yyyy-MM-dd because that is what the input and the API
 * both expect; only the DISPLAY is converted to dd/MM/yyyy, which is what an
 * Indian gym owner reads.
 *
 * The range applies on an explicit click, not on each keystroke. A partially
 * typed year ("0002") would otherwise fire a query for the year 2 and make
 * the screen flicker through nonsense on the way to a valid date.
 */

const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

/** yyyy-MM-dd for an offset from today, in LOCAL time. */
function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toIso(date);
}

function toIso(date: Date): string {
  // Not toISOString(): that converts to UTC and in IST rolls the date back
  // by one for any time before 05:30.
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** dd/MM/yyyy for display, from a yyyy-MM-dd string. */
function display(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return formatDate(new Date(year, month - 1, day));
}

/**
 * Validate and normalise a range that came from a URL or localStorage.
 *
 * Both are user-editable, so neither can be trusted. Two failures matter:
 *
 *  - A malformed date ("banana") must DISABLE the filter rather than be
 *    dropped silently, which would show every member while the chip still
 *    claims a range is applied — filtered-looking but unfiltered.
 *  - A reversed range (end picked before start) is swapped, not rejected.
 *    Returning nothing reads as "no business that fortnight".
 */
export function normaliseRange(
  from: string | null | undefined,
  to: string | null | undefined,
): DateRange | null {
  const valid = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
    if (!match) return null;

    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    // Rejects 2026-02-31, which would otherwise roll into March.
    if (
      date.getFullYear() !== Number(year) ||
      date.getMonth() !== Number(month) - 1 ||
      date.getDate() !== Number(day)
    ) {
      return null;
    }
    return iso.trim();
  };

  const start = valid(from);
  const end = valid(to);
  if (!start || !end) return null;

  return start <= end
    ? { from: start, to: end }
    : { from: end, to: start };
}

/**
 * The order `<input type="date">` will display, e.g. "dd/mm/yyyy".
 *
 * A native date input renders in the BROWSER's locale, which the page cannot
 * override — so on an en-US machine it shows mm/dd/yyyy while the rest of
 * this app shows dd/MM/yyyy. Reading 05/09 as 5 September when the field
 * means 9 May is a wrong number, not a cosmetic slip, so each field states
 * the order it is actually using.
 */
function nativeDateHint(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(2026, 8, 21));

    return parts
      .map((part) =>
        part.type === 'day'
          ? 'dd'
          : part.type === 'month'
            ? 'mm'
            : part.type === 'year'
              ? 'yyyy'
              : part.value,
      )
      .join('');
  } catch {
    return '';
  }
}

export function DateRangePicker({
  value,
  onChange,
  onClear,
  label = 'Custom range',
  className,
}: {
  value: DateRange | null;
  onChange: (range: DateRange) => void;
  onClear?: () => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const today = toIso(new Date());
  const hint = React.useMemo(nativeDateHint, []);

  // Draft state so typing does not fire a query on every keystroke.
  const [draftFrom, setDraftFrom] = React.useState(value?.from ?? '');
  const [draftTo, setDraftTo] = React.useState(value?.to ?? '');

  // Re-sync when the picker is opened, so it reflects an externally
  // cleared or URL-restored range rather than a stale draft.
  React.useEffect(() => {
    if (open) {
      setDraftFrom(value?.from ?? '');
      setDraftTo(value?.to ?? '');
    }
  }, [open, value?.from, value?.to]);

  const valid = Boolean(draftFrom && draftTo);

  function apply(from: string, to: string) {
    onChange({ from, to });
    setOpen(false);
  }

  return (
    <div className={cn('inline-flex items-center', className)}>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              value
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
              // Square off the right edge when the clear button adjoins it.
              value && onClear && 'rounded-r-none border-r-0',
            )}
          >
            <CalendarRange className="size-4 shrink-0" />
            {value ? (
              <span className="tabular whitespace-nowrap">
                {value.from === value.to
                  ? display(value.from)
                  : `${display(value.from)} – ${display(value.to)}`}
              </span>
            ) : (
              label
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-[280px] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Quick ranges
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => apply(isoDaysAgo(preset.days - 1), today)}
                className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => apply(today, today)}
              className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Today
            </button>
          </div>

          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 flex items-baseline justify-between text-[11px] font-medium text-muted-foreground">
                From
                {hint && <span className="tabular font-normal">{hint}</span>}
              </span>
              <input
                type="date"
                value={draftFrom}
                max={draftTo || today}
                onChange={(event) => setDraftFrom(event.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="block">
              <span className="mb-1 flex items-baseline justify-between text-[11px] font-medium text-muted-foreground">
                To
                {hint && <span className="tabular font-normal">{hint}</span>}
              </span>
              <input
                type="date"
                value={draftTo}
                min={draftFrom || undefined}
                onChange={(event) => setDraftTo(event.target.value)}
                className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>

          <Button
            size="sm"
            className="mt-3 w-full"
            disabled={!valid}
            onClick={() => valid && apply(draftFrom, draftTo)}
          >
            Apply range
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Clearing is a separate control: merging it into the trigger would
          mean the same click both opens the picker and discards the range. */}
      {value && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear date range"
          className="rounded-l-none rounded-r-full border border-l-0 border-primary/40 bg-primary/10 py-2 pl-1.5 pr-3 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
