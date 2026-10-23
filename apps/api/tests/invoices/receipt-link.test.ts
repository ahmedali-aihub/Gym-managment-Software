import { describe, expect, it } from 'vitest';
import {
  invoiceIdFromToken,
  receiptToken,
  receiptUrl,
} from '../../src/lib/receipt-link.js';

/**
 * Receipt links are public URLs to a document with a member's name, phone
 * and payments. The only thing standing between a stranger and that PDF is
 * the signature, so these tests are about what must NOT open.
 */
describe('receipt links', () => {
  const invoiceId = 'cmvjk3x9a0001abcdxyz12345';

  it('opens the receipt it was made for', () => {
    expect(invoiceIdFromToken(receiptToken(invoiceId))).toBe(invoiceId);
  });

  it('refuses an altered signature', () => {
    const token = receiptToken(invoiceId);
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(invoiceIdFromToken(token.slice(0, -1) + last)).toBeNull();
  });

  it('refuses one receipt\'s signature on another receipt', () => {
    const other = 'cmvjk3x9a0002abcdxyz12345';
    const signature = receiptToken(invoiceId).split('.')[1];
    expect(invoiceIdFromToken(`${other}.${signature}`)).toBeNull();
  });

  it('refuses a bare invoice id, a truncated token and junk', () => {
    expect(invoiceIdFromToken(invoiceId)).toBeNull();
    expect(invoiceIdFromToken(receiptToken(invoiceId).slice(0, -4))).toBeNull();
    expect(invoiceIdFromToken('')).toBeNull();
    expect(invoiceIdFromToken('.abc')).toBeNull();
  });

  it('builds a link on the public site, under /api/r', () => {
    expect(receiptUrl(invoiceId)).toMatch(
      new RegExp(`^https?://[^/]+/api/r/${invoiceId}\\.[A-Za-z0-9_-]{22}$`),
    );
  });
});
