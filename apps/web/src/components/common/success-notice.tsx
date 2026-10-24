import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * A frosted-glass confirmation, for the moments that deserve more than a
 * toast — a member joining the gym.
 *
 * Deliberately not built on the toast library: its wrapper animates and
 * positions every toast its own way, and this needs its own spring, its own
 * self-drawing tick and its own reduced-motion behaviour. It is one element,
 * plain CSS (the `azf-notice` rules in globals.css) and a module-level
 * listener, so any screen can raise it with `showSuccessNotice(...)`.
 *
 * The host lives above the router, so a notice raised just before
 * navigating — registration jumps straight to the new profile — survives
 * the page change.
 */

export interface SuccessNoticeContent {
  title: string;
  /** The person it is about; the line the eye should land on. */
  name: string;
  /** Secondary facts, joined with a dot: plan, member ID. */
  details: string[];
  /** Optional small print, e.g. what was sent to the member. */
  note?: string;
}

interface Notice extends SuccessNoticeContent {
  id: number;
}

/** On screen this long before it fades. */
const VISIBLE_MS = 3000;
/** Matches the `azf-notice-out` animation in globals.css. */
const EXIT_MS = 280;

let listener: ((notice: Notice) => void) | null = null;
let nextId = 1;

export function showSuccessNotice(content: SuccessNoticeContent): void {
  listener?.({ ...content, id: nextId++ });
}

export function SuccessNoticeHost() {
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const [leaving, setLeaving] = React.useState(false);

  React.useEffect(() => {
    listener = (next) => {
      setLeaving(false);
      setNotice(next);
    };
    return () => {
      listener = null;
    };
  }, []);

  // Visible for VISIBLE_MS, then the exit animation, then gone. Keyed on the
  // notice id, so a second notice restarts the clock instead of inheriting
  // the first one's remaining time.
  React.useEffect(() => {
    if (!notice) return;
    const fade = window.setTimeout(() => setLeaving(true), VISIBLE_MS);
    return () => window.clearTimeout(fade);
  }, [notice]);

  React.useEffect(() => {
    if (!leaving) return;
    const remove = window.setTimeout(() => setNotice(null), EXIT_MS);
    return () => window.clearTimeout(remove);
  }, [leaving]);

  return createPortal(
    // The live region stays mounted: screen readers announce changes INSIDE
    // a region, and often miss one that is inserted already filled.
    <div className="azf-notice-layer" role="status" aria-live="polite">
      {notice && (
        <div
          key={notice.id}
          className="azf-notice"
          data-state={leaving ? 'out' : 'in'}
          // Tap or click to dismiss early.
          onClick={() => setLeaving(true)}
        >
          <span className="azf-notice__badge" aria-hidden>
            <svg viewBox="0 0 24 24" className="azf-notice__check">
              <path
                d="M6.75 12.5l3.5 3.5 7-7.5"
                pathLength={1}
                className="azf-notice__tick"
              />
            </svg>
          </span>

          <span className="azf-notice__text">
            <span className="azf-notice__title">{notice.title}</span>
            <span className="azf-notice__name">{notice.name}</span>
            {notice.details.length > 0 && (
              <span className="azf-notice__meta">
                {notice.details.join('  ·  ')}
              </span>
            )}
            {notice.note && (
              <span className="azf-notice__note">{notice.note}</span>
            )}
          </span>
        </div>
      )}
    </div>,
    document.body,
  );
}
