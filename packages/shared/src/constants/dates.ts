/**
 * Date handling for an Indian gym.
 *
 * Display format is dd/MM/yyyy throughout — never the US MM/dd/yyyy, which
 * would silently misread 05/09 as May 9th instead of 5th September.
 *
 * Storage is always UTC ISO in the database; formatting happens at the edge.
 */

export const DATE_FORMAT_DISPLAY = 'dd/MM/yyyy';
export const DATE_FORMAT_DISPLAY_LONG = 'dd MMM yyyy';
export const DATETIME_FORMAT_DISPLAY = 'dd/MM/yyyy hh:mm a';
export const TIME_FORMAT_DISPLAY = 'hh:mm a';
export const IST_TIMEZONE = 'Asia/Kolkata';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** dd/MM/yyyy — the format every receipt and list uses. */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: IST_TIMEZONE,
  }).format(d);
}

/** 05 Sep 2026 — used where the month must be unambiguous. */
export function formatDateLong(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: IST_TIMEZONE,
  }).format(d);
}

/** 05/09/2026 07:30 PM */
export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: IST_TIMEZONE,
  }).format(d);
}

/** 07:30 PM — for the check-in feed. */
export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';

  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: IST_TIMEZONE,
  }).format(d);
}

/**
 * Whole days from today until `date`. Negative when already past.
 * Both ends are normalised to midnight so "expires today" reads as 0, not -0.4.
 */
export function daysUntil(date: Date | string): number {
  const target = typeof date === 'string' ? new Date(date) : date;
  const today = startOfDay(new Date());
  const targetDay = startOfDay(target);
  return Math.round((targetDay.getTime() - today.getTime()) / MS_PER_DAY);
}

/** Whole days elapsed since `date`. Negative when in the future. */
export function daysSince(date: Date | string): number {
  return -daysUntil(date);
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const targetDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Guard the 31 Jan + 1 month = 3 Mar overflow: clamp to end of target month.
  if (d.getDate() !== targetDay) d.setDate(0);
  return d;
}

/**
 * Membership expiry from a start date and a duration in days.
 * A 30-day plan starting 01/09 expires 30/09 (inclusive), not 01/10 —
 * which is how members and staff actually count it.
 */
export function calculateExpiryDate(startDate: Date, durationDays: number): Date {
  return endOfDay(addDays(startDate, durationDays - 1));
}

/** "Expires in 5 days" / "Expired 3 days ago" / "Expires today". */
export function relativeExpiry(date: Date | string): string {
  const days = daysUntil(date);
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  if (days > 1) return `Expires in ${days} days`;
  if (days === -1) return 'Expired yesterday';
  return `Expired ${Math.abs(days)} days ago`;
}

/** Age in completed years — used for the member profile and birthday SMS. */
export function calculateAge(dob: Date | string): number {
  const birth = typeof dob === 'string' ? new Date(dob) : dob;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/** True when the date's day+month match today, ignoring year. */
export function isBirthdayToday(dob: Date | string): boolean {
  const birth = typeof dob === 'string' ? new Date(dob) : dob;
  const today = new Date();
  return (
    birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth()
  );
}

/**
 * Indian financial year for a date: 1 April – 31 March.
 * Returns e.g. "2026-27". Used for invoice numbering.
 */
export function financialYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed; March = 2
  const startYear = month >= 3 ? year : year - 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, '0')}`;
}

/** yyyy-MM-dd, for <input type="date"> values. */
export function toDateInputValue(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
