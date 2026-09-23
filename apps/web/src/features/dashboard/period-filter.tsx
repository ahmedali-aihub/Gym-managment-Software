import * as React from 'react';
import {
  normaliseRange,
  type DateRange,
} from '@/components/common/date-range-picker';
import { SegmentedControl } from '@/components/common/segmented-control';

export type PeriodKey =
  | 'today'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'all'
  | 'custom';

export const PERIODS: Array<{ key: PeriodKey; label: string; short: string }> = [
  { key: 'today', label: 'Today', short: 'Today' },
  { key: 'week', label: 'This week', short: 'Week' },
  { key: 'month', label: 'This month', short: 'Month' },
  { key: 'quarter', label: 'This quarter', short: 'Quarter' },
  { key: 'year', label: 'This year', short: 'Year' },
  { key: 'all', label: 'All time', short: 'All' },
];

/**
 * Period selector.
 *
 * A segmented control rather than a dropdown: there are only six options, an
 * owner switches between them constantly, and seeing all of them at once makes
 * the comparison obvious. A dropdown would hide five of six and cost a click
 * every time.
 *
 * Built on SegmentedControl, so the marker can be dragged along the rail as
 * well as clicked — the same gesture as the nav bar, and the same spring.
 */
export function PeriodFilter({
  value,
  onChange,
  className,
}: {
  value: PeriodKey;
  onChange: (period: PeriodKey) => void;
  className?: string;
}) {
  return (
    <SegmentedControl
      options={PERIODS.map((period) => ({
        value: period.key,
        label: period.label,
        shortLabel: period.short,
      }))}
      value={value}
      onChange={onChange}
      ariaLabel="Time period"
      className={className}
    />
  );
}

/**
 * Persist the chosen period across reloads — it is a working preference.
 *
 * `storageKey` lets separate screens keep separate periods. Reports is read
 * at "this year" for the accountant; the dashboard is watched at "today" for
 * the floor. One shared key would make each screen fight the other.
 */
export function usePeriod(
  defaultPeriod: PeriodKey = 'month',
  storageKey = 'azf-period',
) {
  const rangeKey = `${storageKey}-range`;

  const [period, setPeriod] = React.useState<PeriodKey>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      // 'custom' is only restorable alongside a stored range; the check
      // below drops it to the default if the range is missing.
      if (stored === 'custom') {
        return localStorage.getItem(rangeKey) ? 'custom' : defaultPeriod;
      }
      if (stored && PERIODS.some((p) => p.key === stored)) {
        return stored as PeriodKey;
      }
    } catch {
      // Storage blocked; fall through to the default.
    }
    return defaultPeriod;
  });

  const [range, setRange] = React.useState<DateRange | null>(() => {
    try {
      const stored = localStorage.getItem(rangeKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as DateRange;
      // Validated like the URL is: localStorage is user-editable too, and a
      // malformed stored range would query the API for a window it cannot
      // resolve.
      return normaliseRange(parsed?.from, parsed?.to);
    } catch {
      // Storage blocked or the value is not valid JSON.
      return null;
    }
  });

  const update = React.useCallback(
    (next: PeriodKey) => {
      setPeriod(next);
      // Choosing a preset discards the range. Leaving it behind would mean a
      // stored range that nothing displays — and the next thing to read it
      // would resurrect a window the owner had already moved on from.
      if (next !== 'custom') setRange(null);

      try {
        localStorage.setItem(storageKey, next);
        if (next !== 'custom') localStorage.removeItem(rangeKey);
      } catch {
        // Preference will not persist; the session still works.
      }
    },
    [storageKey, rangeKey],
  );

  const updateRange = React.useCallback(
    (next: DateRange | null) => {
      setRange(next);
      // Clearing returns to whatever this dashboard's default is, not a
      // hardcoded month — the caller chose that default for a reason.
      const nextPeriod = next ? 'custom' : defaultPeriod;
      setPeriod(nextPeriod);

      try {
        if (next) {
          localStorage.setItem(rangeKey, JSON.stringify(next));
        } else {
          localStorage.removeItem(rangeKey);
        }
        localStorage.setItem(storageKey, nextPeriod);
      } catch {
        // Preference will not persist; the session still works.
      }
    },
    [defaultPeriod, storageKey, rangeKey],
  );

  return { period, setPeriod: update, range, setRange: updateRange } as const;
}
