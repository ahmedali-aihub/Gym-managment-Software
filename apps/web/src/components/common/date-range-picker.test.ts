import { describe, expect, it } from 'vitest';
import { normaliseRange } from './date-range-picker';

/**
 * Range validation tests.
 *
 * Both callers feed this untrusted input — the members page from the URL, the
 * dashboard from localStorage — and both use the result to decide which
 * members and which money the owner is shown. The two failures that matter:
 *
 *  - A malformed date must DISABLE the filter, not be dropped silently. The
 *    silent version showed all 200 members under a chip still claiming a
 *    range was applied.
 *  - A reversed range must be swapped, not rejected. Rejecting returned zero
 *    results, which reads as "no business that fortnight".
 */

describe('normaliseRange', () => {
  it('accepts a well-formed range unchanged', () => {
    expect(normaliseRange('2026-09-01', '2026-09-15')).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it('accepts a single day', () => {
    expect(normaliseRange('2026-09-21', '2026-09-21')).toEqual({
      from: '2026-09-21',
      to: '2026-09-21',
    });
  });

  it('SWAPS a reversed range rather than returning nothing', () => {
    expect(normaliseRange('2026-09-15', '2026-09-01')).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it('rejects a malformed date so the filter is disabled, not silent', () => {
    expect(normaliseRange('banana', '2026-09-15')).toBeNull();
    expect(normaliseRange('2026-09-01', 'banana')).toBeNull();
    expect(normaliseRange('01/09/2026', '15/09/2026')).toBeNull();
    expect(normaliseRange('2026-9-1', '2026-09-15')).toBeNull();
  });

  it('rejects a date that does not exist on the calendar', () => {
    // Without the round-trip check this rolls forward into March and the
    // owner silently gets a window they never asked for.
    expect(normaliseRange('2026-02-31', '2026-03-15')).toBeNull();
    expect(normaliseRange('2026-13-01', '2026-12-15')).toBeNull();
    expect(normaliseRange('2026-00-10', '2026-01-15')).toBeNull();
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(normaliseRange('2028-02-29', '2028-03-01')).not.toBeNull();
    expect(normaliseRange('2026-02-29', '2026-03-01')).toBeNull();
  });

  it('returns null when either end is missing', () => {
    expect(normaliseRange(null, '2026-09-15')).toBeNull();
    expect(normaliseRange('2026-09-01', null)).toBeNull();
    expect(normaliseRange(undefined, undefined)).toBeNull();
    expect(normaliseRange('', '')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(normaliseRange(' 2026-09-01 ', '2026-09-15 ')).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it('compares across month and year boundaries, not as plain numbers', () => {
    // Lexicographic order on yyyy-MM-dd matches chronological order, which
    // is the whole reason the swap check can be a string comparison.
    expect(normaliseRange('2026-12-31', '2027-01-01')).toEqual({
      from: '2026-12-31',
      to: '2027-01-01',
    });
    expect(normaliseRange('2027-01-01', '2026-12-31')).toEqual({
      from: '2026-12-31',
      to: '2027-01-01',
    });
  });
});
