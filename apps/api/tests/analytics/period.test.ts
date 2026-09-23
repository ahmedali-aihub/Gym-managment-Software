import { describe, expect, it } from 'vitest';
import { resolvePeriod } from '../../src/modules/dashboard/analytics.service.js';

/**
 * Period resolution tests.
 *
 * Indian financial quarters (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar) are the
 * easiest thing here to get subtly wrong, and a wrong quarter boundary means
 * the owner compares the wrong two numbers without ever noticing.
 */

/**
 * Format a date as yyyy-MM-dd in LOCAL time.
 *
 * `toISOString()` would be wrong here. The service works in local time —
 * correct for a gym whose business day starts at 6am IST — and converting
 * back to UTC shifts every boundary backwards by the offset. Local midnight
 * on 19 September IST is 18:30 UTC on the 18th, so an ISO-based assertion
 * reports the wrong day for every single period.
 */
function iso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('resolvePeriod — today', () => {
  it('spans midnight to end of day', () => {
    const now = new Date('2026-09-19T14:30:00');
    const range = resolvePeriod('today', now);

    expect(iso(range.from)).toBe('2026-09-19');
    expect(range.from.getHours()).toBe(0);
    expect(range.to.getHours()).toBe(23);
  });

  it('compares against yesterday', () => {
    const range = resolvePeriod('today', new Date('2026-09-19T14:30:00'));
    expect(iso(range.previousFrom)).toBe('2026-09-18');
    expect(iso(range.previousTo)).toBe('2026-09-18');
  });
});

describe('resolvePeriod — week', () => {
  it('starts on Monday', () => {
    // 19 Sep 2026 is a Saturday.
    const range = resolvePeriod('week', new Date('2026-09-19T10:00:00'));
    expect(iso(range.from)).toBe('2026-09-14');
    expect(range.from.getDay()).toBe(1);
  });

  it('treats Sunday as the end of the week, not the start', () => {
    // 20 Sep 2026 is a Sunday; its week began Monday the 14th.
    const range = resolvePeriod('week', new Date('2026-09-20T10:00:00'));
    expect(iso(range.from)).toBe('2026-09-14');
  });

  it('compares against the preceding seven days', () => {
    const range = resolvePeriod('week', new Date('2026-09-19T10:00:00'));
    expect(iso(range.previousFrom)).toBe('2026-09-07');
  });
});

describe('resolvePeriod — month', () => {
  it('starts on the first', () => {
    const range = resolvePeriod('month', new Date('2026-09-19T10:00:00'));
    expect(iso(range.from)).toBe('2026-09-01');
  });

  it('compares against the whole previous month', () => {
    const range = resolvePeriod('month', new Date('2026-09-19T10:00:00'));
    expect(iso(range.previousFrom)).toBe('2026-08-01');
    expect(iso(range.previousTo)).toBe('2026-08-31');
  });

  it('handles January, rolling back to December of the prior year', () => {
    const range = resolvePeriod('month', new Date('2026-01-15T10:00:00'));
    expect(iso(range.previousFrom)).toBe('2025-12-01');
    expect(iso(range.previousTo)).toBe('2025-12-31');
  });
});

describe('resolvePeriod — quarter (Indian financial year)', () => {
  it.each([
    // Q1: Apr–Jun
    { date: '2026-05-15', start: '2026-04-01', previous: '2026-01-01' },
    // Q2: Jul–Sep
    { date: '2026-09-19', start: '2026-07-01', previous: '2026-04-01' },
    // Q3: Oct–Dec
    { date: '2026-11-10', start: '2026-10-01', previous: '2026-07-01' },
    // Q4: Jan–Mar — belongs to the PREVIOUS calendar year's FY.
    { date: '2026-02-20', start: '2026-01-01', previous: '2025-10-01' },
  ])('$date falls in the quarter starting $start', ({ date, start, previous }) => {
    const range = resolvePeriod('quarter', new Date(`${date}T10:00:00`));

    expect(iso(range.from)).toBe(start);
    expect(iso(range.previousFrom)).toBe(previous);
  });

  it('does not use calendar quarters', () => {
    // A calendar-quarter implementation would put 19 September in the quarter
    // starting 1 July as well — so pick a date where the two disagree.
    // 15 April: financial Q1 starts 1 Apr; calendar Q2 also starts 1 Apr.
    // 15 March: financial Q4 starts 1 Jan; calendar Q1 also starts 1 Jan.
    // The real divergence is in the PREVIOUS period.
    const range = resolvePeriod('quarter', new Date('2026-04-15T10:00:00'));

    // Financial: previous quarter is Jan–Mar.
    expect(iso(range.previousFrom)).toBe('2026-01-01');
    expect(iso(range.previousTo)).toBe('2026-03-31');
  });
});

describe('resolvePeriod — year (Indian financial year)', () => {
  it('starts on 1 April for a date after April', () => {
    const range = resolvePeriod('year', new Date('2026-09-19T10:00:00'));
    expect(iso(range.from)).toBe('2026-04-01');
  });

  it('rolls back to the previous April for a date before April', () => {
    // February 2026 belongs to FY 2025-26, which began 1 April 2025.
    const range = resolvePeriod('year', new Date('2026-02-20T10:00:00'));
    expect(iso(range.from)).toBe('2025-04-01');
  });

  it('compares against the previous financial year', () => {
    const range = resolvePeriod('year', new Date('2026-09-19T10:00:00'));
    expect(iso(range.previousFrom)).toBe('2025-04-01');
    expect(iso(range.previousTo)).toBe('2026-03-31');
  });

  it('treats 31 March as the last day of the financial year', () => {
    const range = resolvePeriod('year', new Date('2026-03-31T23:00:00'));
    expect(iso(range.from)).toBe('2025-04-01');
  });

  it('treats 1 April as the first day of a new financial year', () => {
    const range = resolvePeriod('year', new Date('2026-04-01T01:00:00'));
    expect(iso(range.from)).toBe('2026-04-01');
  });
});

describe('resolvePeriod — all time', () => {
  it('has no meaningful comparison window', () => {
    const range = resolvePeriod('all', new Date('2026-09-19T10:00:00'));

    // An empty previous range yields zero, and the UI renders "new" rather
    // than a misleading percentage.
    expect(range.previousFrom.getTime()).toBe(range.previousTo.getTime());
  });
});

describe('every period', () => {
  it('always produces a range where from precedes to', () => {
    const now = new Date('2026-09-19T14:30:00');

    for (const key of ['today', 'week', 'month', 'quarter', 'year', 'all'] as const) {
      const range = resolvePeriod(key, now);
      expect(range.from.getTime()).toBeLessThanOrEqual(range.to.getTime());
      expect(range.previousFrom.getTime()).toBeLessThanOrEqual(
        range.previousTo.getTime(),
      );
    }
  });

  it('never lets the previous window overlap the current one', () => {
    const now = new Date('2026-09-19T14:30:00');

    for (const key of ['today', 'week', 'month', 'quarter', 'year'] as const) {
      const range = resolvePeriod(key, now);
      // Overlapping windows would double-count payments in the comparison.
      expect(range.previousTo.getTime()).toBeLessThan(range.from.getTime());
    }
  });
});

describe('custom range', () => {
  const now = new Date('2026-09-21T14:30:00');

  it('covers the whole of both boundary days', () => {
    const range = resolvePeriod('custom', now, {
      from: new Date('2026-09-01T11:00:00'),
      to: new Date('2026-09-15T09:00:00'),
    });

    // A payment taken at 09:30 on the 1st, or 22:00 on the 15th, must be
    // inside the range. Truncating either end silently loses a day's cash.
    expect(range.from.getHours()).toBe(0);
    expect(range.from.getDate()).toBe(1);
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
    expect(range.to.getDate()).toBe(15);
  });

  it('compares against the SAME NUMBER OF DAYS immediately before', () => {
    // 1–15 Sept is 15 days, so the comparison is 17–31 Aug, also 15 days.
    const range = resolvePeriod('custom', now, {
      from: new Date('2026-09-01'),
      to: new Date('2026-09-15'),
    });

    expect(range.previousTo.getMonth()).toBe(7); // August
    expect(range.previousTo.getDate()).toBe(31);
    expect(range.previousFrom.getMonth()).toBe(7);
    expect(range.previousFrom.getDate()).toBe(17);

    const dayMs = 24 * 60 * 60 * 1000;
    const currentDays = Math.round(
      (range.to.getTime() - range.from.getTime()) / dayMs,
    );
    const previousDays = Math.round(
      (range.previousTo.getTime() - range.previousFrom.getTime()) / dayMs,
    );
    expect(previousDays).toBe(currentDays);
  });

  it('handles a single day, comparing it against the day before', () => {
    const range = resolvePeriod('custom', now, {
      from: new Date('2026-09-21'),
      to: new Date('2026-09-21'),
    });

    expect(range.from.getDate()).toBe(21);
    expect(range.to.getDate()).toBe(21);
    expect(range.previousFrom.getDate()).toBe(20);
    expect(range.previousTo.getDate()).toBe(20);
    expect(range.label).toBe('21/09/2026');
  });

  it('labels a multi-day range in dd/MM/yyyy', () => {
    const range = resolvePeriod('custom', now, {
      from: new Date('2026-09-01'),
      to: new Date('2026-09-15'),
    });

    expect(range.label).toBe('01/09/2026 – 15/09/2026');
  });

  it('swaps a reversed range rather than returning nothing', () => {
    // Pick the end date first in the UI and you get to < from. Returning an
    // empty range would look like "no business that fortnight".
    const range = resolvePeriod('custom', now, {
      from: new Date('2026-09-15'),
      to: new Date('2026-09-01'),
    });

    expect(range.from.getDate()).toBe(1);
    expect(range.to.getDate()).toBe(15);
  });

  it('crosses a month boundary without distorting the comparison', () => {
    // 25 Aug – 5 Sept is 12 days; the predecessor is 13–24 Aug.
    const range = resolvePeriod('custom', now, {
      from: new Date('2026-08-25'),
      to: new Date('2026-09-05'),
    });

    expect(range.previousTo.getDate()).toBe(24);
    expect(range.previousTo.getMonth()).toBe(7);
    expect(range.previousFrom.getDate()).toBe(13);
    expect(range.previousFrom.getMonth()).toBe(7);
  });

  it('never overlaps the current window', () => {
    const range = resolvePeriod('custom', now, {
      from: new Date('2026-09-01'),
      to: new Date('2026-09-15'),
    });

    expect(range.previousTo.getTime()).toBeLessThan(range.from.getTime());
  });

  it('throws rather than silently inventing a range', () => {
    expect(() => resolvePeriod('custom', now)).toThrow(/requires a from\/to/);
  });
});
