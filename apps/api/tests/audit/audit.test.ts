import { describe, expect, it } from 'vitest';
import { diffRecords } from '../../src/services/audit/audit.service.js';

/**
 * Audit diffing tests.
 *
 * The trail exists to answer "who changed this, and what did it look like
 * before". Two failures make it worthless:
 *
 *  - Storing whole rows. A phone correction then shows forty identical
 *    fields and one different one, and the reviewer has to diff by eye.
 *  - Recording no-op saves. Opening a member and pressing Save without
 *    typing fills the log with empty entries until nobody reads it.
 */

describe('diffRecords', () => {
  it('keeps only the fields that changed', () => {
    const delta = diffRecords(
      { fullName: 'Aarav Yadav', phone: '9876543210', city: 'Hyderabad' },
      { fullName: 'Aarav Yadav', phone: '9000000000', city: 'Hyderabad' },
    );

    expect(delta).not.toBeNull();
    expect(delta!.before).toEqual({ phone: '9876543210' });
    expect(delta!.after).toEqual({ phone: '9000000000' });
  });

  it('returns null when nothing changed', () => {
    expect(
      diffRecords({ fullName: 'Aarav', phone: '9876543210' }, { fullName: 'Aarav', phone: '9876543210' }),
    ).toBeNull();
  });

  it('never records a credential, even when it changed', () => {
    // A trail holding a working QR token hands anyone with read access a
    // valid gym pass.
    const delta = diffRecords(
      { qrToken: 'old-token', passwordHash: 'old-hash', fullName: 'Aarav' },
      { qrToken: 'new-token', passwordHash: 'new-hash', fullName: 'Priya' },
    );

    expect(delta).not.toBeNull();
    expect(delta!.after).toEqual({ fullName: 'Priya' });
    expect(JSON.stringify(delta)).not.toContain('token');
    expect(JSON.stringify(delta)).not.toContain('hash');
  });

  it('returns null when only redacted fields changed', () => {
    expect(
      diffRecords({ qrToken: 'a', fullName: 'Aarav' }, { qrToken: 'b', fullName: 'Aarav' }),
    ).toBeNull();
  });

  it('compares dates by value, not by reference', () => {
    // Two Date objects for the same instant are never === , so a naive
    // comparison would log a change on every single save.
    const same = diffRecords(
      { endDate: new Date('2026-12-20T00:00:00Z') },
      { endDate: new Date('2026-12-20T00:00:00Z') },
    );
    expect(same).toBeNull();

    const changed = diffRecords(
      { endDate: new Date('2026-12-20T00:00:00Z') },
      { endDate: new Date('2027-03-20T00:00:00Z') },
    );
    expect(changed).not.toBeNull();
    // Serialised, because a raw Date is not JSON.
    expect(typeof changed!.after.endDate).toBe('string');
  });

  it('records a field being cleared', () => {
    // Clearing an email is a real change the owner may need to explain.
    const delta = diffRecords(
      { email: 'a@example.com' },
      { email: null },
    );

    expect(delta).not.toBeNull();
    expect(delta!.before).toEqual({ email: 'a@example.com' });
    expect(delta!.after).toEqual({ email: null });
  });

  it('records a field being added', () => {
    const delta = diffRecords({}, { medicalNotes: 'Knee injury' });
    expect(delta!.after).toEqual({ medicalNotes: 'Knee injury' });
  });

  it('normalises undefined to null so the entry is valid JSON', () => {
    const delta = diffRecords({ notes: 'x' }, { notes: undefined });
    expect(delta).not.toBeNull();
    expect(delta!.after).toEqual({ notes: null });
  });

  it('detects a change inside an array field', () => {
    const delta = diffRecords(
      { goals: ['WEIGHT_LOSS'] },
      { goals: ['WEIGHT_LOSS', 'MUSCLE_GAIN'] },
    );

    expect(delta).not.toBeNull();
    expect(delta!.after.goals).toEqual(['WEIGHT_LOSS', 'MUSCLE_GAIN']);
  });

  it('ignores an array reordered to the same values only when identical', () => {
    // Order carries no meaning for goals, but treating [a,b] and [b,a] as
    // equal would need a sort the DB does not guarantee — so a reorder is
    // reported. Better a noisy entry than a silently dropped change.
    const delta = diffRecords(
      { goals: ['A', 'B'] },
      { goals: ['B', 'A'] },
    );
    expect(delta).not.toBeNull();
  });
});

describe('timestamp noise', () => {
  it('never records updatedAt, which changes on every single write', () => {
    // Caught against the live database: every entry read "phone, updatedAt"
    // and the reviewer had to filter noise out of the one real change.
    const delta = diffRecords(
      { phone: '9876543210', updatedAt: new Date('2026-01-01') },
      { phone: '9000000000', updatedAt: new Date('2026-09-23') },
    );

    expect(delta).not.toBeNull();
    expect(Object.keys(delta!.after)).toEqual(['phone']);
  });

  it('returns null when only timestamps moved', () => {
    expect(
      diffRecords(
        { updatedAt: new Date('2026-01-01'), createdAt: new Date('2025-01-01') },
        { updatedAt: new Date('2026-09-23'), createdAt: new Date('2025-01-01') },
      ),
    ).toBeNull();
  });
});
