import { describe, expect, it } from 'vitest';
import {
  renewalUndoBlocker,
  type RenewalUndoCandidate,
} from '../../src/modules/plans/memberships.service.js';

/**
 * Undo is for the desk's mistakes: any renewal nothing has built on since,
 * however long ago. Everything else must be refused, because the undo
 * deletes rows.
 */
const renewal = (overrides: Partial<RenewalUndoCandidate> = {}): RenewalUndoCandidate => ({
  supersededById: null,
  supersedes: null,
  events: [{ type: 'RENEWED' }],
  payments: [{ refundedPaise: 0 }],
  ...overrides,
});

describe('renewalUndoBlocker', () => {
  it('allows an untouched renewal, with no time limit', () => {
    expect(renewalUndoBlocker(renewal())).toBeNull();
  });

  it('allows one with no payment taken', () => {
    expect(renewalUndoBlocker(renewal({ payments: [] }))).toBeNull();
  });

  it('refuses a registration — only renewals can be undone', () => {
    expect(renewalUndoBlocker(renewal({ events: [{ type: 'CREATED' }] }))).toMatch(/only a renewal/);
  });

  it('refuses one that was frozen, upgraded or transferred since', () => {
    expect(renewalUndoBlocker(renewal({ events: [{ type: 'RENEWED' }, { type: 'FROZEN' }] }))).toMatch(/since/);
    expect(renewalUndoBlocker(renewal({ supersededById: 'next' }))).toMatch(/since/);
    expect(renewalUndoBlocker(renewal({ supersedes: { id: 'old' } }))).toMatch(/since/);
  });

  it('refuses one whose payment has been refunded', () => {
    expect(renewalUndoBlocker(renewal({ payments: [{ refundedPaise: 50_000 }] }))).toMatch(/refunded/);
  });
});
