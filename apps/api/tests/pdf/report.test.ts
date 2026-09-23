import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  generateReportPdf,
  type ReportData,
} from '../../src/services/pdf/report.service.js';

/**
 * Business report PDF.
 *
 * The charts are drawn as vectors, so there is nothing to assert about them
 * beyond "the document has content". What these tests protect is the part a
 * reader would immediately notice as broken: mangled currency, missing
 * sections, and pages that fail to render at all.
 */

const MONTHS = [
  'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar',
  'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
];

function buildData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    overview: {
      members: {
        total: 200,
        active: 72,
        expired: 111,
        frozen: 9,
        expiringSoon: 6,
      },
      joins: { thisMonth: 13, lastMonth: 16 },
      revenue: {
        thisMonthPaise: 46_60_000,
        lastMonthPaise: 41_90_000,
        collectedPaise: 3_14_50_000,
        pendingPaise: 22_50_000,
      },
      retention: { churnRatePercent: 6.4, retentionRatePercent: 93.6 },
    },
    revenueTrend: MONTHS.map((month, index) => ({
      month,
      collectedPaise: (180_000 + index * 22_000) * 100,
    })),
    memberGrowth: MONTHS.map((month) => ({ month, joined: 10, expired: 4 })),
    planDistribution: [
      { name: 'Quarterly', value: 24 },
      { name: 'Monthly', value: 21 },
    ],
    paymentModes: [
      { name: 'UPI', value: 84_50_000 },
      { name: 'Cash', value: 42_00_000 },
    ],
    defaulters: [
      {
        memberId: 'AZF-2026-0042',
        fullName: 'Venkata Subramanyam',
        phone: '9876543210',
        balanceDuePaise: 12_00_000,
      },
    ],
    ...overrides,
  };
}

/**
 * Pull readable text out of a PDF.
 *
 * PDFKit writes page content into FlateDecode streams as kerned HEX arrays
 * (`[<52> 120 <73>] TJ`), so searching the raw buffer finds nothing even when
 * the document renders perfectly.
 */
function extractText(buffer: Buffer): string {
  const parts: string[] = [];
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');

  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    const end = buffer.indexOf(endMarker, start);
    if (end === -1) break;

    let dataStart = start + marker.length;
    while (
      dataStart < buffer.length &&
      (buffer[dataStart] === 0x0d || buffer[dataStart] === 0x0a)
    ) {
      dataStart++;
    }

    try {
      parts.push(inflateSync(buffer.subarray(dataStart, end)).toString('latin1'));
    } catch {
      // Not a deflate stream (fonts, images).
    }

    cursor = end + endMarker.length;
  }

  const content = parts.join('\n');
  const shown: string[] = [];

  for (const match of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    let line = '';
    for (const hex of (match[1] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)) {
      const digits = hex[1] ?? '';
      for (let i = 0; i + 1 < digits.length; i += 2) {
        line += String.fromCharCode(parseInt(digits.slice(i, i + 2), 16));
      }
    }
    if (line) shown.push(line);
  }

  return shown.join('\n');
}

describe('generateReportPdf', () => {
  it('produces a valid multi-page PDF', async () => {
    const { buffer } = await generateReportPdf(buildData(), 'This year');

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(buffer.subarray(-6).toString('ascii')).toContain('EOF');
    // Two pages of charts and tables is substantially more than a blank doc.
    expect(buffer.byteLength).toBeGreaterThan(20_000);
  });

  it('names the file by date', async () => {
    const { filename } = await generateReportPdf(buildData(), 'This year');
    expect(filename).toMatch(/^azf-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('renders every section heading', async () => {
    const { buffer } = await generateReportPdf(buildData(), 'This year');
    const text = extractText(buffer);

    for (const heading of [
      'AT A GLANCE',
      'REVENUE TREND',
      'MEMBER GROWTH',
      'PLAN MIX',
      'PAYMENT METHODS',
      'COLLECTIONS SUMMARY',
      'MEMBERSHIP BREAKDOWN',
      'LARGEST OUTSTANDING BALANCES',
    ]) {
      expect(text).toContain(heading);
    }
  });

  it('carries the period label through to the document', async () => {
    const { buffer } = await generateReportPdf(buildData(), 'This quarter');
    expect(extractText(buffer)).toContain('This quarter');
  });
});

describe('currency rendering', () => {
  /**
   * The regression this guards.
   *
   * PDFKit's built-in Helvetica uses WinAnsi encoding, which has no rupee
   * glyph — a literal ₹ silently renders as a superscript one, so "₹12,000"
   * prints as "¹12,000". On a report handed to an accountant that reads as
   * broken software, and nothing in the build would have caught it.
   */
  it('never emits a raw rupee sign', async () => {
    const { buffer } = await generateReportPdf(buildData(), 'This year');
    const text = extractText(buffer);

    expect(text).not.toContain('₹');
  });

  it('writes amounts as Rs. instead', async () => {
    const { buffer } = await generateReportPdf(buildData(), 'This year');
    const text = extractText(buffer);

    expect(text).toContain('Rs.');

    // The separator is a NON-BREAKING space (U+00A0), deliberately, so
    // "Rs." can never wrap away from its number. Asserting with a plain
    // space here would fail even though the output is correct.
    expect(text).toContain('Rs. 22,500');
  });

  it('uses Indian digit grouping, not Western', async () => {
    const { buffer } = await generateReportPdf(buildData(), 'This year');
    const text = extractText(buffer);

    // 3_14_50_000 paise = Rs. 3,14,500 — lakh grouping.
    expect(text).toContain('3,14,500');
    // The Western grouping of the same number would be 314,500.
    expect(text).not.toContain('314,500');
  });
});

describe('resilience', () => {
  it('renders with no defaulters', async () => {
    const { buffer } = await generateReportPdf(
      buildData({ defaulters: [] }),
      'This year',
    );

    const text = extractText(buffer);
    // The section is skipped entirely rather than printing an empty table.
    expect(text).not.toContain('LARGEST OUTSTANDING BALANCES');
    expect(buffer.byteLength).toBeGreaterThan(10_000);
  });

  it('renders for a brand-new gym with no data at all', async () => {
    const { buffer } = await generateReportPdf(
      buildData({
        revenueTrend: [],
        memberGrowth: [],
        planDistribution: [],
        paymentModes: [],
        defaulters: [],
      }),
      'This month',
    );

    // Charts with no bars must not throw — day one of a new gym is a real
    // state, and a report that crashes then is worse than a sparse one.
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(extractText(buffer)).toContain('No data for this period');
  });

  it('survives a long member name in the dues table', async () => {
    const { buffer } = await generateReportPdf(
      buildData({
        defaulters: [
          {
            memberId: 'AZF-2026-0999',
            fullName: 'Venkata Naga Sai Subramanyam Chowdary Reddy',
            phone: '9876543210',
            balanceDuePaise: 5_00_000,
          },
        ],
      }),
      'This year',
    );

    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
