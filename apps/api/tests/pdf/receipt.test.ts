import { describe, expect, it, vi } from 'vitest';

/**
 * Receipt PDF tests.
 *
 * A PDF that compiles but renders blank is a real failure mode, so these
 * assert on the produced bytes: a valid header, a non-trivial size, and the
 * correct document type for the gym's tax status.
 */

const invoiceFixture = {
  id: 'inv_1',
  invoiceNumber: 'RCPT/2026-27/0001',
  issuedAt: new Date('2026-09-19T10:30:00Z'),
  subtotalPaise: 400_000,
  discountPaise: 0,
  taxablePaise: 400_000,
  cgstPaise: 0,
  sgstPaise: 0,
  igstPaise: 0,
  totalPaise: 400_000,
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
      addressLine1: '12-3, Main Road',
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
  membership: { plan: { name: 'Quarterly' } },
  payment: {
    mode: 'UPI',
    reference: '123456789012',
    paidAt: new Date('2026-09-19T10:30:00Z'),
  },
};

const prismaFake = {
  invoice: {
    findUniqueOrThrow: vi.fn(async () => invoiceFixture),
    update: vi.fn(async () => invoiceFixture),
  },
};

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: prismaFake,
  isPrismaError: () => false,
  PrismaErrorCode: {},
}));

const { generateReceiptPdf } = await import(
  '../../src/services/pdf/receipt.service.js'
);

/**
 * Extract readable text from a PDF.
 *
 * PDFKit writes page content into FlateDecode (zlib) streams, so the drawn
 * text is not present as raw bytes — searching the buffer directly finds
 * nothing even when the document renders perfectly. Each stream is inflated
 * and the text-showing operators are pulled out.
 *
 * This is a test helper, not a general PDF parser: it only needs to see
 * whether a given label was drawn.
 */
async function extractText(buffer: Buffer): Promise<string> {
  const { inflateSync } = await import('node:zlib');
  const parts: string[] = [];

  // Locate each `stream ... endstream` block and try to inflate it.
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');

  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;

    const end = buffer.indexOf(endMarker, start);
    if (end === -1) break;

    // Skip past "stream" and the newline that follows it.
    let dataStart = start + marker.length;
    while (
      dataStart < buffer.length &&
      (buffer[dataStart] === 0x0d || buffer[dataStart] === 0x0a)
    ) {
      dataStart++;
    }

    const chunk = buffer.subarray(dataStart, end);

    try {
      parts.push(inflateSync(chunk).toString('latin1'));
    } catch {
      // Not a deflate stream (fonts, images) — ignore it.
    }

    cursor = end + endMarker.length;
  }

  const content = parts.join('\n');

  /**
   * PDFKit emits text as a kerned array of HEX strings, not plain literals:
   *
   *   [<50> 120 <41> 100 <594d454e54> 0] TJ
   *
   * Each <...> is hex-encoded characters and the bare numbers are kerning
   * adjustments, which are dropped. A naive search for `(text) Tj` finds
   * nothing here, which is exactly the trap this helper exists to avoid.
   */
  const shown: string[] = [];

  for (const match of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const segment = match[1] ?? '';
    let line = '';

    for (const hex of segment.matchAll(/<([0-9A-Fa-f]*)>/g)) {
      const digits = hex[1] ?? '';
      for (let i = 0; i + 1 < digits.length; i += 2) {
        line += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
      }
    }

    if (line) shown.push(line);
  }

  // Plain literals too, in case a future PDFKit version stops hex-encoding.
  for (const match of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
    shown.push((match[1] ?? '').replace(/\\([()\\])/g, '$1'));
  }

  return shown.join('\n');
}

describe('generateReceiptPdf', () => {
  it('produces a valid PDF', async () => {
    const { buffer } = await generateReceiptPdf('inv_1');

    // Every PDF begins with %PDF-
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // And ends with the EOF marker.
    expect(buffer.subarray(-6).toString('ascii')).toContain('EOF');
  });

  it('produces a document with actual content, not a blank page', async () => {
    const { buffer } = await generateReceiptPdf('inv_1');

    // An empty single-page PDF is roughly 1 KB. Anything meaningful is
    // several times that once fonts and text are embedded.
    expect(buffer.byteLength).toBeGreaterThan(2000);
  });

  it('names the file after the receipt number, filesystem-safe', async () => {
    const { filename } = await generateReceiptPdf('inv_1');

    // Slashes in RCPT/2026-27/0001 would create directories.
    expect(filename).toBe('RCPT-2026-27-0001.pdf');
    expect(filename).not.toContain('/');
  });

  it('issues a receipt, not a tax invoice, when not GST registered', async () => {
    const { buffer } = await generateReceiptPdf('inv_1');
    const text = await extractText(buffer);

    // PDFKit writes literal strings into the content stream, so the label is
    // findable even without parsing the document properly.
    expect(text).toContain('PAYMENT RECEIPT');
    expect(text).not.toContain('TAX INVOICE');
  });

  it('switches to a tax invoice when GST applies', async () => {
    prismaFake.invoice.findUniqueOrThrow.mockResolvedValueOnce({
      ...invoiceFixture,
      isGstInvoice: true,
      gstRate: 18,
      gstin: '36AABCU9603R1ZX',
      sacCode: '999723',
      taxablePaise: 338_983,
      cgstPaise: 30_509,
      sgstPaise: 30_508,
      totalPaise: 400_000,
    } as never);

    const { buffer } = await generateReceiptPdf('inv_1');
    const text = await extractText(buffer);

    expect(text).toContain('TAX INVOICE');
    expect(text).toContain('36AABCU9603R1ZX');
  });

  it('renders a discounted bill without losing the subtotal line', async () => {
    prismaFake.invoice.findUniqueOrThrow.mockResolvedValueOnce({
      ...invoiceFixture,
      subtotalPaise: 450_000,
      discountPaise: 50_000,
      taxablePaise: 400_000,
      totalPaise: 400_000,
    } as never);

    const { buffer } = await generateReceiptPdf('inv_1');
    const text = await extractText(buffer);

    expect(text).toContain('Subtotal');
    expect(text).toContain('Discount');
  });

  it('embeds the gym logo', async () => {
    const { buffer } = await generateReceiptPdf('inv_1');
    const raw = buffer.toString('latin1');

    // An embedded raster appears as an XObject of subtype /Image. Without
    // this the header silently falls back to text-only and nobody notices
    // until a member is handed a plain receipt.
    expect(raw).toContain('/Subtype /Image');
  });

  it('survives a missing snapshot by falling back to the member record', async () => {
    prismaFake.invoice.findUniqueOrThrow.mockResolvedValueOnce({
      ...invoiceFixture,
      snapshot: null,
    } as never);

    // Older rows may predate the snapshot column; a receipt must still print.
    await expect(generateReceiptPdf('inv_1')).resolves.toMatchObject({
      filename: 'RCPT-2026-27-0001.pdf',
    });
  });
});
