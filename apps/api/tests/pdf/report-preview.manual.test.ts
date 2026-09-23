import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/** Renders a sample report to ./tmp so the watermark can be looked at. */
vi.mock('../../src/lib/prisma.js', () => ({ prisma: {} }));

const { generateReportPdf } = await import(
  '../../src/services/pdf/report.service.js'
);

const months = ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'];

describe('report preview', () => {
  it('writes a sample report to ./tmp for visual review', async () => {
    const { buffer } = await generateReportPdf(
      {
        overview: {
          members: { total: 200, active: 91, expired: 96, frozen: 2, expiringSoon: 6 },
          joins: { thisMonth: 39, lastMonth: 29 },
          revenue: { thisMonthPaise: 20_200_00, lastMonthPaise: 8_600_00, collectedPaise: 80_294_000, pendingPaise: 18_368_500 },
          retention: { churnRatePercent: 6.4, retentionRatePercent: 93.6 },
        },
        revenueTrend: months.map((m, i) => ({
          month: m,
          collectedPaise: (180_000 + i * 22_000) * 100,
          pendingPaise: 0,
        })),
        memberGrowth: months.map((m, i) => ({
          month: m,
          joined: 7 + (i % 5),
          expired: 8 - (i % 4),
        })),
        planDistribution: [
          { name: 'Half-Yearly', value: 16 },
          { name: 'Yearly', value: 16 },
          { name: 'Quarterly', value: 14 },
          { name: 'Monthly', value: 5 },
        ],
        paymentModes: [
          { name: 'UPI', value: 8_45_000 * 100 },
          { name: 'Cash', value: 4_20_000 * 100 },
        ],
        defaulters: [
          { memberId: 'AZF-2026-0016', fullName: 'Ramesh Goud', phone: '9876543210', balanceDuePaise: 50_000 },
        ],
      },
      'This year',
    );

    const outDir = path.resolve('./tmp');
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'report-preview.pdf'), buffer);

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    // eslint-disable-next-line no-console
    console.log(`\n  Report written to: ${path.join(outDir, 'report-preview.pdf')}\n`);
  });
});
