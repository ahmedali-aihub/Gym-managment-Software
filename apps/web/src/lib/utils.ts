import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes, resolving conflicts in favour of the last one.
 * Without twMerge, `cn('p-2', 'p-4')` would emit both and the winner would
 * depend on stylesheet order rather than call order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** "Rahul Sharma" → "RS". Used for avatar fallbacks. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * Deterministic colour from a string, so a given member always gets the same
 * avatar tint across sessions and devices. Random colours would make the
 * member list feel unstable between page loads.
 */
export function stringToColor(input: string): string {
  const palette = [
    'bg-chart-1/15 text-chart-1',
    'bg-chart-2/15 text-chart-2',
    'bg-chart-3/15 text-chart-3',
    'bg-chart-4/15 text-chart-4',
    'bg-chart-5/15 text-chart-5',
    'bg-chart-6/15 text-chart-6',
  ];

  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = input.charCodeAt(i) + ((hash << 5) - hash);
  }

  return palette[Math.abs(hash) % palette.length] ?? palette[0]!;
}

/** Delay a call until the caller stops firing — for search inputs. */
export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/** Truncate with an ellipsis, without cutting mid-word where avoidable. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/** "2 minutes ago" / "just now" — for the live check-in feed. */
export function timeAgo(date: Date | string): string {
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);

  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return then.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Percentage change between two periods, guarding division by zero. */
export function percentChange(current: number, previous: number): number | null {
  // Growth from zero is undefined, not infinite — the UI shows "new" instead.
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Clamp a number into a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
