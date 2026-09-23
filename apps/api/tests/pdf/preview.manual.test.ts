import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Renders a sample receipt to ./tmp so the document can be LOOKED at.
 *
 * A test rather than a script because vitest already mocks Prisma cleanly;
 * a standalone script would need its own ESM interception. It asserts the
 * PDF is valid, so it earns its place in the suite either way.
 */
const invoiceFixture = {
  id: 'inv_1',
  invoiceNumber: 'RCPT/2026-27/0042',
  issuedAt: new Date('2026-09-22T10:30:00'),
  subtotalPaise: 400_000,
  discountPaise: 50_000,
  taxablePaise: 350_000,
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 0,
  totalPaise: 350_000,
  gstRate: 0,
  gstin: null,
  sacCode: null,
  isGstInvoice: false,
  snapshot: {
    member: {
      memberId: 'AZF-2026-0042',
      fullName: 'Rahul Sharma',
      phone: '9876543210',
      email: 'rahul@example.com',
      addressLine1: '12-3, Mehdipatnam Main Road',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500028',
    },
    paymentMode: 'UPI',
    reference: '123456789012',
  },
  member: {
    memberId: 'AZF-2026-0042',
    fullName: 'Rahul Sharma',
    phone: '9876543210',
    email: 'rahul@example.com',
  },
  membership: {
    plan: { name: 'Quarterly' },
    startDate: new Date('2026-09-22'),
    endDate: new Date('2026-12-21'),
  },
  payment: {
    mode: 'UPI',
    reference: '123456789012',
    paidAt: new Date('2026-09-22T10:30:00'),
  },
};

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: {
    invoice: {
      findUniqueOrThrow: vi.fn(async () => invoiceFixture),
      update: vi.fn(async () => invoiceFixture),
    },
  },
}));

const { generateReceiptPdf } = await import(
  '../../src/services/pdf/receipt.service.js'
);

describe('receipt preview', () => {
  it('writes a sample receipt to ./tmp for visual review', async () => {
    const { buffer, filename } = await generateReceiptPdf('inv_1');

    const outDir = path.resolve('./tmp');
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'receipt-preview.pdf');
    await writeFile(outPath, buffer);

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(filename).toMatch(/\.pdf$/);

    // eslint-disable-next-line no-console
    console.log(`\n  Receipt written to: ${outPath}\n`);
  });
});
