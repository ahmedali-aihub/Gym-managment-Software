import { describe, expect, it } from 'vitest';
import { parseCsv } from './parse-csv';

/**
 * CSV parsing tests.
 *
 * The failure that matters: `split(',')` on a quoted address shifts every
 * later column left by one, so phone numbers land in the email field. On
 * 6,500 rows nobody notices until a member complains.
 */

describe('parseCsv', () => {
  it('reads a simple file', () => {
    const { headers, rows } = parseCsv('Name,Mobile\nAarav,9876543210');
    expect(headers).toEqual(['Name', 'Mobile']);
    expect(rows).toEqual([{ Name: 'Aarav', Mobile: '9876543210' }]);
  });

  it('keeps a quoted field containing a comma in ONE column', () => {
    const { rows } = parseCsv(
      'Name,Address,Mobile\nAarav,"12-3, Main Road",9876543210',
    );
    expect(rows[0]!.Address).toBe('12-3, Main Road');
    // The real test: the phone did not shift into the wrong column.
    expect(rows[0]!.Mobile).toBe('9876543210');
  });

  it('handles a doubled quote as a literal quote', () => {
    const { rows } = parseCsv('Name,Notes\nAarav,"He said ""hello"""');
    expect(rows[0]!.Notes).toBe('He said "hello"');
  });

  it('handles a newline inside a quoted field', () => {
    const { rows } = parseCsv('Name,Address\nAarav,"Line one\nLine two"');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Address).toBe('Line one\nLine two');
  });

  it('strips the UTF-8 BOM Excel writes', () => {
    // Without this the first header is "\uFEFFName" and matches nothing.
    const { headers } = parseCsv('\uFEFFName,Mobile\nAarav,9876543210');
    expect(headers[0]).toBe('Name');
  });

  it('handles Windows line endings', () => {
    const { rows } = parseCsv('Name,Mobile\r\nAarav,9876543210\r\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Mobile).toBe('9876543210');
  });

  it('ignores trailing blank lines', () => {
    const { rows } = parseCsv('Name,Mobile\nAarav,9876543210\n\n\n');
    expect(rows).toHaveLength(1);
  });

  it('fills missing trailing cells rather than dropping the column', () => {
    // Old exports often omit trailing empties.
    const { rows } = parseCsv('Name,Mobile,Email\nAarav,9876543210');
    expect(rows[0]!.Email).toBe('');
  });

  it('trims whitespace around values', () => {
    const { rows } = parseCsv('Name , Mobile\n Aarav , 9876543210 ');
    expect(rows[0]!.Name).toBe('Aarav');
  });

  it('returns empty for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});
