import { Gender, MemberStatus } from '@azf/shared';
import { describe, expect, it } from 'vitest';
import {
  detectDateOrder,
  findDuplicates,
  mapColumns,
  parseLegacyDate,
  parseRow,
  summarise,
} from '../../src/modules/import/parse-import.js';

/**
 * Legacy import tests.
 *
 * The import runs once, over 6,500 rows, into a live database. Every failure
 * here is silent and expensive:
 *
 *  - A month-first file read as day-first shifts every expiry by months.
 *    Renewal reminders go to the wrong people and revenue lands in the wrong
 *    period, with no error to notice.
 *  - A landline accepted as a mobile produces a member who can never be
 *    contacted, discovered only when a renewal is missed.
 *  - Historical members imported as ACTIVE make every retention figure
 *    meaningless from day one.
 */

const MAPPING = {
  fullName: 'Name',
  phone: 'Mobile',
  dateOfBirth: 'DOB',
  gender: 'Gender',
  joinedAt: 'Join Date',
  membershipEnd: 'Expiry',
  planName: 'Package',
};

describe('mapColumns', () => {
  it('recognises the column names old gym software actually uses', () => {
    const { mapping } = mapColumns([
      'Member Name',
      'Mobile No',
      'DOB',
      'Sex',
      'Date of Joining',
      'Valid Till',
      'Package',
    ]);

    expect(mapping.fullName).toBe('Member Name');
    expect(mapping.phone).toBe('Mobile No');
    expect(mapping.dateOfBirth).toBe('DOB');
    expect(mapping.gender).toBe('Sex');
    expect(mapping.joinedAt).toBe('Date of Joining');
    expect(mapping.membershipEnd).toBe('Valid Till');
    expect(mapping.planName).toBe('Package');
  });

  it('ignores case, spacing and punctuation in headers', () => {
    const { mapping } = mapColumns(['  FULL_NAME  ', 'phone-number']);
    expect(mapping.fullName).toBe('  FULL_NAME  ');
    expect(mapping.phone).toBe('phone-number');
  });

  it('reports columns it could not place', () => {
    const { unmapped } = mapColumns(['Name', 'Mobile', 'Locker No', 'Trainer']);
    expect(unmapped).toContain('Locker No');
    expect(unmapped).toContain('Trainer');
  });

  it('never maps two fields to the same column', () => {
    const { mapping } = mapColumns(['Name', 'Contact']);
    const columns = Object.values(mapping);
    expect(new Set(columns).size).toBe(columns.length);
  });
});

describe('parseLegacyDate', () => {
  it('reads dd/mm/yyyy DAY-FIRST, as Indian software writes it', () => {
    const date = parseLegacyDate('01/02/2024');
    // 1 February, NOT 2 January.
    expect(date?.getDate()).toBe(1);
    expect(date?.getMonth()).toBe(1);
    expect(date?.getFullYear()).toBe(2024);
  });

  it('accepts dashes and dots as separators', () => {
    expect(parseLegacyDate('15-03-2024')?.getMonth()).toBe(2);
    expect(parseLegacyDate('15.03.2024')?.getMonth()).toBe(2);
  });

  it('reads ISO dates as written', () => {
    const date = parseLegacyDate('2024-02-01');
    expect(date?.getDate()).toBe(1);
    expect(date?.getMonth()).toBe(1);
  });

  it('builds dates in LOCAL time, not UTC', () => {
    // `new Date('2024-02-01')` is 05:30 IST on the 1st; a UTC-built date
    // would shift every value in the file back by half a day.
    const date = parseLegacyDate('01/02/2024');
    expect(date?.getHours()).toBe(0);
    expect(date?.getDate()).toBe(1);
  });

  it('reads named months', () => {
    expect(parseLegacyDate('12 Jan 2024')?.getMonth()).toBe(0);
    expect(parseLegacyDate('12-Mar-24')?.getMonth()).toBe(2);
    expect(parseLegacyDate('12-Mar-24')?.getFullYear()).toBe(2024);
  });

  it('expands two-digit years around 1950', () => {
    // 90 is a birth year; 25 is a membership expiry.
    expect(parseLegacyDate('15/06/90')?.getFullYear()).toBe(1990);
    expect(parseLegacyDate('15/06/25')?.getFullYear()).toBe(2025);
  });

  it('rejects a date that does not exist', () => {
    // Without the round-trip check this rolls into March and the member
    // silently gets a birth date nobody entered.
    expect(parseLegacyDate('31/02/2024')).toBeNull();
    expect(parseLegacyDate('32/01/2024')).toBeNull();
  });

  it('returns null rather than guessing at unreadable input', () => {
    expect(parseLegacyDate('')).toBeNull();
    expect(parseLegacyDate(undefined)).toBeNull();
    expect(parseLegacyDate('not a date')).toBeNull();
    expect(parseLegacyDate('N/A')).toBeNull();
  });
});

describe('detectDateOrder', () => {
  it('proves day-first when a first number exceeds 12', () => {
    expect(detectDateOrder(['15/06/2024', '03/04/2024'])).toBe('day-first');
  });

  it('proves month-first when only a second number exceeds 12', () => {
    expect(detectDateOrder(['06/15/2024', '04/03/2024'])).toBe('month-first');
  });

  it('reports ambiguous when every value fits both readings', () => {
    // 03/04 could be 3 April or 4 March; the file cannot answer this and
    // the importer must ask rather than assume.
    expect(detectDateOrder(['03/04/2024', '05/06/2024'])).toBe('ambiguous');
  });

  it('ignores values it cannot parse', () => {
    expect(detectDateOrder(['15/06/2024', 'N/A', ''])).toBe('day-first');
  });
});

describe('parseRow', () => {
  const base = {
    Name: 'Aarav Yadav',
    Mobile: '9876543210',
    DOB: '15/06/1990',
    Gender: 'M',
    'Join Date': '01/01/2024',
    Expiry: '31/12/2099',
    Package: 'Quarterly',
  };

  it('parses a clean row with no issues', () => {
    const result = parseRow(base, MAPPING, 2);

    expect(result.severity).toBe('ok');
    expect(result.issues).toHaveLength(0);
    expect(result.member?.fullName).toBe('Aarav Yadav');
    expect(result.member?.phone).toBe('9876543210');
    expect(result.member?.gender).toBe(Gender.MALE);
    expect(result.member?.status).toBe(MemberStatus.ACTIVE);
  });

  it('normalises the phone formats old systems store', () => {
    for (const raw of ['+91 98765 43210', '098765-43210', '91 9876543210']) {
      const result = parseRow({ ...base, Mobile: raw }, MAPPING, 2);
      expect(result.member?.phone, raw).toBe('9876543210');
    }
  });

  it('rejects a landline rather than importing an uncontactable member', () => {
    const result = parseRow({ ...base, Mobile: '040 23456789' }, MAPPING, 2);
    expect(result.severity).toBe('error');
    expect(result.member).toBeNull();
  });

  it('refuses a row with no name at all', () => {
    const result = parseRow({ ...base, Name: '' }, MAPPING, 2);
    expect(result.severity).toBe('error');
    expect(result.member).toBeNull();
  });

  it('imports a missing date of birth as incomplete, not as an error', () => {
    const result = parseRow({ ...base, DOB: '' }, MAPPING, 2);

    expect(result.member).not.toBeNull();
    expect(result.member?.dateOfBirth).toBeNull();
    expect(result.member?.incompleteFields).toContain('dateOfBirth');
  });

  it('imports a missing gender as incomplete', () => {
    const result = parseRow({ ...base, Gender: '' }, MAPPING, 2);
    expect(result.member?.gender).toBeNull();
    expect(result.member?.incompleteFields).toContain('gender');
  });

  it('marks a lapsed membership EXPIRED, not active', () => {
    // Importing years of historical members as ACTIVE makes every retention
    // and churn figure meaningless from the first day.
    const result = parseRow({ ...base, Expiry: '31/12/2020' }, MAPPING, 2);
    expect(result.member?.status).toBe(MemberStatus.EXPIRED);
  });

  it('treats a member with no expiry date as expired', () => {
    const result = parseRow({ ...base, Expiry: '' }, MAPPING, 2);
    expect(result.member?.status).toBe(MemberStatus.EXPIRED);
    expect(result.severity).toBe('warning');
  });

  it('flags an expiry that precedes the joining date', () => {
    const result = parseRow(
      { ...base, 'Join Date': '01/06/2024', Expiry: '01/01/2024' },
      MAPPING,
      2,
    );
    expect(result.issues.some((i) => i.field === 'membershipEnd')).toBe(true);
  });

  it('rejects a birth date in the future', () => {
    const result = parseRow({ ...base, DOB: '01/01/2099' }, MAPPING, 2);
    expect(result.member?.dateOfBirth).toBeNull();
    expect(result.member?.incompleteFields).toContain('dateOfBirth');
  });

  it('swaps day and month when told the file is month-first', () => {
    const result = parseRow({ ...base, DOB: '06/15/1990' }, MAPPING, 2, {
      dateOrder: 'month-first',
    });
    expect(result.member?.dateOfBirth?.getDate()).toBe(15);
    expect(result.member?.dateOfBirth?.getMonth()).toBe(5);
  });
});

describe('findDuplicates', () => {
  const make = (rowNumber: number, phone: string) =>
    parseRow(
      {
        Name: `Member ${rowNumber}`,
        Mobile: phone,
        DOB: '15/06/1990',
        Gender: 'M',
        Expiry: '31/12/2099',
      },
      MAPPING,
      rowNumber,
    );

  it('groups rows that share a phone number', () => {
    const duplicates = findDuplicates([
      make(2, '9876543210'),
      make(3, '9000000001'),
      make(4, '9876543210'),
    ]);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.rowNumbers).toEqual([2, 4]);
  });

  it('reports rather than drops, because families share numbers', () => {
    const rows = [make(2, '9876543210'), make(3, '9876543210')];
    const duplicates = findDuplicates(rows);
    // Both rows survive parsing; the owner decides what to do.
    expect(rows.every((r) => r.member !== null)).toBe(true);
    expect(duplicates[0]!.rowNumbers).toHaveLength(2);
  });
});

describe('summarise', () => {
  it('counts what will happen before anything is written', () => {
    const rows = [
      parseRow({ Name: 'A', Mobile: '9876543210', DOB: '15/06/1990', Gender: 'M', Expiry: '31/12/2099' }, MAPPING, 2),
      parseRow({ Name: 'B', Mobile: '9000000002', DOB: '', Gender: '', Expiry: '01/01/2020' }, MAPPING, 3),
      parseRow({ Name: '', Mobile: '9000000003', Expiry: '31/12/2099' }, MAPPING, 4),
    ];

    const summary = summarise(rows);
    expect(summary.total).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.incomplete).toBe(1);
    expect(summary.activeAfterImport).toBe(1);
    expect(summary.expiredAfterImport).toBe(1);
  });
});
