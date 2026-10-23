import { describe, expect, it } from 'vitest';
import {
  RENEWAL_UNDO_WINDOW_DAYS,
  renewalUndoBlocker,
  type RenewalUndoCandidate,
} from '../../src/modules/plans/memberships.service.js';

/**
 * Undo is for the desk's mistakes: a recent renewal nothing has built on.
 * Everything else must be refused, because the undo deletes rows.
 */
const now = new Date('2026-10-23T12:00:00Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

const renewal = (overrides: Partial<RenewalUndoCandidate> = {}): RenewalUndoCandidate => ({
  createdAt: daysAgo(0),
  supersededById: null,
  supersedes: null,
  events: [{ type: 'RENEWED' }],
  payments: [{ refundedPaise: 0 }],
  ...overrides,
});

describe('renewalUndoBlocker', () => {
  it('allows a fresh, untouched renewal', () => {
    expect(renewalUndoBlocker(renewal(), now)).toBeNull();
  });

  it('allows one with no payment taken', () => {
    expect(renewalUndoBlocker(renewal({ payments: [] }), now)).toBeNull();
  });

  it('refuses a registration — only renewals can be undone', () => {
    expect(renewalUndoBlocker(renewal({ events: [{ type: 'CREATED' }] }), now)).toMatch(/only a renewal/);
  });

  it('refuses one that was frozen, upgraded or transferred since', () => {
    expect(renewalUndoBlocker(renewal({ events: [{ type: 'RENEWED' }, { type: 'FROZEN' }] }), now)).toMatch(/since/);
    expect(renewalUndoBlocker(renewal({ supersededById: 'next' }), now)).toMatch(/since/);
    expect(renewalUndoBlocker(renewal({ supersedes: { id: 'old' } }), now)).toMatch(/since/);
  });

  it('refuses one whose payment has been refunded', () => {
    expect(renewalUndoBlocker(renewal({ payments: [{ refundedPaise: 50_000 }] }), now)).toMatch(/refunded/);
  });

  it(`allows up to ${RENEWAL_UNDO_WINDOW_DAYS} days, not after`, () => {
    expect(renewalUndoBlocker(renewal({ createdAt: daysAgo(RENEWAL_UNDO_WINDOW_DAYS - 0.1) }), now)).toBeNull();
    expect(renewalUndoBlocker(renewal({ createdAt: daysAgo(RENEWAL_UNDO_WINDOW_DAYS + 0.1) }), now)).toMatch(/within/);
  });
});
