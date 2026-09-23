import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  formatDate,
  formatINR,
  formatINRCompact,
  paiseToRupees,
} from '@azf/shared';
import PDFDocument from 'pdfkit';
import { gymConfig } from '../../config/env.js';
import { moduleLogger } from '../../lib/logger.js';

const log = moduleLogger('pdf:report');

/**
 * Business report PDF.
 *
 * This is the document an owner hands to an accountant, a bank, or a
 * prospective investor, so it is laid out as a printed report rather than a
 * screenshot of the dashboard: a cover block, headline figures, charts drawn
 * as vectors, and tables that survive being photocopied.
 *
 * Charts are drawn with PDFKit primitives rather than embedding a rendered
 * image. Vectors stay sharp at any zoom and print crisply, and it avoids
 * running a headless browser on the server just to rasterise a bar chart.
 */

// ── Layout ────────────────────────────────────────────────────────────────

const PAGE_MARGIN = 44;
const LOGO_SIZE = 46;

/**
 * Render an amount for PDF output.
 *
 * PDFKit's built-in Helvetica uses WinAnsi encoding, which has no glyph for
 * the rupee sign — it silently renders as a superscript one, so "₹12,000"
 * prints as "¹12,000". On a financial report handed to an accountant that
 * reads as broken software.
 *
 * Embedding a Unicode font would fix the glyph but adds ~300 KB to every
 * document. "Rs." is unambiguous in India, prints everywhere, and costs
 * nothing.
 */
function money(paise: number, compact = false): string {
  const formatted = compact
    ? formatINRCompact(paise)
    : formatINR(paise, { showDecimals: false });

  return formatted.replace(/₹/g, 'Rs. ');
}

/**
 * Palette.
 *
 * Deliberately restrained and print-safe: the bronze reads as a warm grey on
 * a monochrome printer, and the series colours differ in LIGHTNESS as well as
 * hue so a photocopied chart is still readable.
 */
const COLORS = {
  ink: '#1c1917',
  body: '#44403c',
  muted: '#78716c',
  faint: '#a8a29e',
  line: '#e7e5e4',
  panel: '#faf9f7',
  accent: '#8a6642',
  success: '#3d7a5c',
  danger: '#b4523f',
  series: ['#8a6642', '#5a7a94', '#b08d5e', '#4f7a63', '#9a8478', '#6b6382'],
} as const;

export interface ReportData {
  overview: {
    members: {
      total: number;
      active: number;
      expired: number;
      frozen: number;
      expiringSoon: number;
    };
    joins: { thisMonth: number; lastMonth: number };
    revenue: {
      thisMonthPaise: number;
      lastMonthPaise: number;
      collectedPaise: number;
      pendingPaise: number;
    };
    retention: { churnRatePercent: number; retentionRatePercent: number };
  };
  revenueTrend: Array<{ month: string; collectedPaise: number }>;
  memberGrowth: Array<{ month: string; joined: number; expired: number }>;
  planDistribution: Array<{ name: string; value: number }>;
  paymentModes: Array<{ name: string; value: number }>;
  defaulters: Array<{
    memberId: string;
    fullName: string;
    phone: string;
    balanceDuePaise: number;
  }>;
}

let logoCache: Buffer | null | undefined;

async function loadLogo(): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;

  const candidates = [
    path.resolve(process.cwd(), '../web/public/logo-256.png'),
    path.resolve(process.cwd(), 'apps/web/public/logo-256.png'),
    path.resolve(process.cwd(), '../../apps/web/public/logo-256.png'),
  ];

  for (const candidate of candidates) {
    try {
      logoCache = await readFile(candidate);
      return logoCache;
    } catch {
      // Try the next location.
    }
  }

  logoCache = null;
  return null;
}

type Doc = InstanceType<typeof PDFDocument>;

export async function generateReportPdf(
  data: ReportData,
  periodLabel: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: `${gymConfig.name} — Business Report`,
      Author: gymConfig.name,
      Subject: `Performance report, ${periodLabel}`,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const width = doc.page.width - PAGE_MARGIN * 2;

  // ── Cover header ────────────────────────────────────────────────────
  let y = PAGE_MARGIN;
  const logo = await loadLogo();

  if (logo) {
    try {
      doc.image(logo, PAGE_MARGIN, y, { fit: [LOGO_SIZE, LOGO_SIZE] });
    } catch {
      // Corrupt image; continue without it.
    }
  }

  const textX = logo ? PAGE_MARGIN + LOGO_SIZE + 14 : PAGE_MARGIN;

  doc
    .fillColor(COLORS.ink)
    .fontSize(19)
    .font('Helvetica-Bold')
    .text(gymConfig.name, textX, y + 3);

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(
      `${gymConfig.addressLine1}, ${gymConfig.addressLine2}`,
      textX,
      y + 26,
    );

  doc
    .fillColor(COLORS.accent)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('BUSINESS REPORT', PAGE_MARGIN, y + 4, { width, align: 'right' });

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(periodLabel, PAGE_MARGIN, y + 21, { width, align: 'right' })
    .text(
      `Generated ${formatDate(new Date())}`,
      PAGE_MARGIN,
      y + 34,
      { width, align: 'right' },
    );

  y += LOGO_SIZE + 14;
  rule(doc, y, width);
  y += 20;

  // ── Headline figures ────────────────────────────────────────────────
  y = section(doc, 'AT A GLANCE', y, width);

  const { overview } = data;
  const netCollected = overview.revenue.collectedPaise;

  const tiles: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'Total members', value: String(overview.members.total) },
    {
      label: 'Active',
      value: String(overview.members.active),
      tone: COLORS.success,
    },
    {
      label: 'Collected',
      value: money(netCollected, true),
      tone: COLORS.success,
    },
    {
      label: 'Outstanding',
      value: money(overview.revenue.pendingPaise, true),
      tone: COLORS.danger,
    },
  ];

  const tileWidth = (width - 3 * 10) / 4;

  tiles.forEach((tile, index) => {
    const x = PAGE_MARGIN + index * (tileWidth + 10);

    doc.roundedRect(x, y, tileWidth, 56, 6).fill(COLORS.panel);

    doc
      .fillColor(COLORS.muted)
      .fontSize(7.5)
      .font('Helvetica-Bold')
      .text(tile.label.toUpperCase(), x + 10, y + 11, {
        width: tileWidth - 20,
      });

    doc
      .fillColor(tile.tone ?? COLORS.ink)
      .fontSize(17)
      .font('Helvetica-Bold')
      .text(tile.value, x + 10, y + 26, { width: tileWidth - 20 });
  });

  y += 56 + 24;

  // ── Revenue trend ───────────────────────────────────────────────────
  y = section(doc, 'REVENUE TREND', y, width);

  drawBarChart(doc, {
    x: PAGE_MARGIN,
    y,
    width,
    height: 130,
    bars: data.revenueTrend.map((point) => ({
      label: point.month,
      value: paiseToRupees(point.collectedPaise),
    })),
    formatValue: (value) => money(value * 100, true),
  });

  y += 130 + 26;

  // ── Member growth ───────────────────────────────────────────────────
  y = section(doc, 'MEMBER GROWTH', y, width);

  drawGroupedBars(doc, {
    x: PAGE_MARGIN,
    y,
    width,
    height: 120,
    groups: data.memberGrowth.map((point) => ({
      label: point.month,
      values: [point.joined, point.expired],
    })),
    seriesLabels: ['Joined', 'Expired'],
  });

  y += 120 + 30;

  // ── Plan mix & payment methods, side by side ────────────────────────
  const halfWidth = (width - 18) / 2;

  const planY = section(doc, 'PLAN MIX', y, halfWidth, PAGE_MARGIN);
  section(doc, 'PAYMENT METHODS', y, halfWidth, PAGE_MARGIN + halfWidth + 18);

  drawShareTable(doc, {
    x: PAGE_MARGIN,
    y: planY,
    width: halfWidth,
    rows: data.planDistribution.map((slice) => ({
      label: slice.name,
      value: slice.value,
      display: String(slice.value),
    })),
  });

  drawShareTable(doc, {
    x: PAGE_MARGIN + halfWidth + 18,
    y: planY,
    width: halfWidth,
    rows: data.paymentModes.map((mode) => ({
      label: mode.name,
      value: mode.value,
      display: money(mode.value, true),
    })),
  });

  // ── Page 2: financial detail ────────────────────────────────────────
  doc.addPage();
  y = PAGE_MARGIN;

  y = section(doc, 'COLLECTIONS SUMMARY', y, width);

  const summaryRows: Array<[string, string, string?]> = [
    ['Collected, all time', money(netCollected), COLORS.success],
    ['Collected this month', money(overview.revenue.thisMonthPaise)],
    ['Collected last month', money(overview.revenue.lastMonthPaise)],
    ['Outstanding dues', money(overview.revenue.pendingPaise), COLORS.danger],
  ];

  y = drawKeyValueTable(doc, PAGE_MARGIN, y, width, summaryRows);
  y += 22;

  // ── Membership breakdown ────────────────────────────────────────────
  y = section(doc, 'MEMBERSHIP BREAKDOWN', y, width);

  y = drawKeyValueTable(doc, PAGE_MARGIN, y, width, [
    ['Total members', String(overview.members.total)],
    ['Active', String(overview.members.active), COLORS.success],
    ['Expiring within 7 days', String(overview.members.expiringSoon)],
    ['Expired', String(overview.members.expired), COLORS.danger],
    ['Frozen', String(overview.members.frozen)],
    ['New joins this month', String(overview.joins.thisMonth)],
    ['Retention rate', `${overview.retention.retentionRatePercent}%`, COLORS.success],
    ['Churn rate', `${overview.retention.churnRatePercent}%`, COLORS.danger],
  ]);

  y += 22;

  // ── Outstanding dues ────────────────────────────────────────────────
  if (data.defaulters.length > 0) {
    y = section(doc, 'LARGEST OUTSTANDING BALANCES', y, width);

    const cols = [
      { label: 'MEMBER ID', width: width * 0.22 },
      { label: 'NAME', width: width * 0.38 },
      { label: 'PHONE', width: width * 0.22 },
      { label: 'DUE', width: width * 0.18, align: 'right' as const },
    ];

    doc.rect(PAGE_MARGIN, y, width, 20).fill(COLORS.panel);

    let colX = PAGE_MARGIN + 8;
    for (const col of cols) {
      doc
        .fillColor(COLORS.muted)
        .fontSize(7.5)
        .font('Helvetica-Bold')
        .text(col.label, colX, y + 7, {
          width: col.width - 16,
          align: col.align ?? 'left',
        });
      colX += col.width;
    }

    y += 20;

    for (const [index, member] of data.defaulters.entries()) {
      // Zebra striping survives photocopying better than hairline rules.
      if (index % 2 === 1) {
        doc.rect(PAGE_MARGIN, y, width, 19).fill('#fdfcfb');
      }

      const cells = [
        member.memberId,
        member.fullName,
        member.phone,
        money(member.balanceDuePaise),
      ];

      colX = PAGE_MARGIN + 8;
      cells.forEach((cell, cellIndex) => {
        const col = cols[cellIndex]!;
        doc
          .fillColor(cellIndex === 3 ? COLORS.danger : COLORS.body)
          .fontSize(8.5)
          .font(cellIndex === 3 ? 'Helvetica-Bold' : 'Helvetica')
          .text(cell, colX, y + 6, {
            width: col.width - 16,
            align: col.align ?? 'left',
            lineBreak: false,
          });
        colX += col.width;
      });

      y += 19;
    }

    const totalDue = data.defaulters.reduce(
      (sum, member) => sum + member.balanceDuePaise,
      0,
    );

    rule(doc, y + 2, width);

    doc
      .fillColor(COLORS.ink)
      .fontSize(9)
      .font('Helvetica-Bold')
      .text('Listed total', PAGE_MARGIN + 8, y + 10)
      .fillColor(COLORS.danger)
      .text(money(totalDue), PAGE_MARGIN, y + 10, {
        width: width - 8,
        align: 'right',
      });
  }

  // ── Footers on every page ───────────────────────────────────────────
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    const footerY = doc.page.height - PAGE_MARGIN - 18;
    rule(doc, footerY, width);

    doc
      .fillColor(COLORS.faint)
      .fontSize(7.5)
      .font('Helvetica')
      .text(
        `${gymConfig.name} · ${periodLabel}`,
        PAGE_MARGIN,
        footerY + 7,
        { width: width / 2 },
      );

    doc.text(
      `Page ${i - range.start + 1} of ${range.count}`,
      PAGE_MARGIN,
      footerY + 7,
      { width, align: 'right' },
    );
  }

  doc.end();

  const buffer = await done;
  const filename = `azf-report-${new Date().toISOString().slice(0, 10)}.pdf`;

  log.debug({ filename, pages: range.count }, 'Report PDF generated');

  return { buffer, filename };
}

// ── Drawing helpers ───────────────────────────────────────────────────────

function rule(doc: Doc, y: number, width: number): void {
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + width, y)
    .strokeColor(COLORS.line)
    .lineWidth(0.8)
    .stroke();
}

/** Section heading. Returns the y position content should start at. */
function section(
  doc: Doc,
  title: string,
  y: number,
  width: number,
  x = PAGE_MARGIN,
): number {
  doc
    .fillColor(COLORS.accent)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text(title, x, y, { width, characterSpacing: 0.6 });

  return y + 16;
}

/**
 * Vertical bar chart.
 *
 * Bars are scaled against the largest value rather than a fixed axis, which
 * keeps a quiet month readable instead of collapsing it to a sliver.
 */
function drawBarChart(
  doc: Doc,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    bars: Array<{ label: string; value: number }>;
    formatValue: (value: number) => string;
  },
): void {
  const { x, y, width, height, bars, formatValue } = options;
  if (bars.length === 0) return;

  const chartHeight = height - 26;
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const slot = width / bars.length;
  const barWidth = Math.min(slot * 0.56, 26);

  // Baseline
  doc
    .moveTo(x, y + chartHeight)
    .lineTo(x + width, y + chartHeight)
    .strokeColor(COLORS.line)
    .lineWidth(0.8)
    .stroke();

  bars.forEach((bar, index) => {
    const barHeight = Math.max(2, (bar.value / max) * (chartHeight - 14));
    const barX = x + index * slot + (slot - barWidth) / 2;
    const barY = y + chartHeight - barHeight;

    doc.roundedRect(barX, barY, barWidth, barHeight, 2).fill(COLORS.series[0]);

    // Value above the tallest few only — labelling all twelve is clutter.
    if (bar.value >= max * 0.55) {
      doc
        .fillColor(COLORS.muted)
        .fontSize(6.5)
        .font('Helvetica-Bold')
        .text(formatValue(bar.value), barX - slot * 0.2, barY - 9, {
          width: barWidth + slot * 0.4,
          align: 'center',
          lineBreak: false,
        });
    }

    doc
      .fillColor(COLORS.faint)
      .fontSize(7)
      .font('Helvetica')
      .text(bar.label, x + index * slot, y + chartHeight + 6, {
        width: slot,
        align: 'center',
        lineBreak: false,
      });
  });
}

/** Two series side by side per group, with a legend. */
function drawGroupedBars(
  doc: Doc,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    groups: Array<{ label: string; values: number[] }>;
    seriesLabels: string[];
  },
): void {
  const { x, y, width, height, groups, seriesLabels } = options;
  if (groups.length === 0) return;

  const chartHeight = height - 30;
  const max = Math.max(...groups.flatMap((group) => group.values), 1);
  const slot = width / groups.length;
  const barWidth = Math.min((slot * 0.6) / seriesLabels.length, 11);

  doc
    .moveTo(x, y + chartHeight)
    .lineTo(x + width, y + chartHeight)
    .strokeColor(COLORS.line)
    .lineWidth(0.8)
    .stroke();

  groups.forEach((group, groupIndex) => {
    const groupWidth = barWidth * seriesLabels.length + 2;
    const startX = x + groupIndex * slot + (slot - groupWidth) / 2;

    group.values.forEach((value, seriesIndex) => {
      const barHeight = Math.max(1.5, (value / max) * (chartHeight - 10));
      const barX = startX + seriesIndex * (barWidth + 2);

      doc
        .roundedRect(
          barX,
          y + chartHeight - barHeight,
          barWidth,
          barHeight,
          1.5,
        )
        .fill(COLORS.series[seriesIndex] ?? COLORS.series[0]);
    });

    doc
      .fillColor(COLORS.faint)
      .fontSize(7)
      .font('Helvetica')
      .text(group.label, x + groupIndex * slot, y + chartHeight + 6, {
        width: slot,
        align: 'center',
        lineBreak: false,
      });
  });

  // Legend
  let legendX = x;
  const legendY = y + chartHeight + 19;

  seriesLabels.forEach((label, index) => {
    doc
      .roundedRect(legendX, legendY, 7, 7, 1.5)
      .fill(COLORS.series[index] ?? COLORS.series[0]);

    doc
      .fillColor(COLORS.muted)
      .fontSize(7.5)
      .font('Helvetica')
      .text(label, legendX + 11, legendY + 0.5, { lineBreak: false });

    legendX += 11 + label.length * 4 + 16;
  });
}

/**
 * Horizontal share bars.
 *
 * Used instead of a pie chart: comparing arc areas is genuinely harder than
 * comparing bar lengths, and a pie prints poorly in monochrome.
 */
function drawShareTable(
  doc: Doc,
  options: {
    x: number;
    y: number;
    width: number;
    rows: Array<{ label: string; value: number; display: string }>;
  },
): void {
  const { x, y, width, rows } = options;
  if (rows.length === 0) {
    doc
      .fillColor(COLORS.faint)
      .fontSize(8)
      .font('Helvetica-Oblique')
      .text('No data for this period', x, y);
    return;
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  let rowY = y;

  for (const [index, row] of rows.entries()) {
    const share = row.value / total;

    doc
      .fillColor(COLORS.body)
      .fontSize(8)
      .font('Helvetica')
      .text(row.label, x, rowY, { width: width * 0.46, lineBreak: false });

    doc
      .fillColor(COLORS.ink)
      .font('Helvetica-Bold')
      .text(row.display, x, rowY, {
        width: width * 0.46,
        align: 'right',
        lineBreak: false,
      });

    // Track and fill
    const barY = rowY + 12;
    const barWidth = width * 0.46;

    doc.roundedRect(x, barY, barWidth, 4, 2).fill(COLORS.line);
    doc
      .roundedRect(x, barY, Math.max(2, barWidth * share), 4, 2)
      .fill(COLORS.series[index % COLORS.series.length] ?? COLORS.series[0]);

    doc
      .fillColor(COLORS.faint)
      .fontSize(7)
      .font('Helvetica')
      .text(`${Math.round(share * 100)}%`, x + barWidth + 6, barY - 1.5, {
        lineBreak: false,
      });

    rowY += 24;
  }
}

/** Label/value rows with a hairline between each. */
function drawKeyValueTable(
  doc: Doc,
  x: number,
  y: number,
  width: number,
  rows: Array<[string, string, string?]>,
): number {
  let rowY = y;

  for (const [label, value, tone] of rows) {
    doc
      .fillColor(COLORS.body)
      .fontSize(9)
      .font('Helvetica')
      .text(label, x + 8, rowY + 5, { width: width * 0.6, lineBreak: false });

    doc
      .fillColor(tone ?? COLORS.ink)
      .font('Helvetica-Bold')
      .text(value, x, rowY + 5, {
        width: width - 8,
        align: 'right',
        lineBreak: false,
      });

    rowY += 20;

    doc
      .moveTo(x, rowY)
      .lineTo(x + width, rowY)
      .strokeColor(COLORS.line)
      .lineWidth(0.5)
      .stroke();
  }

  return rowY;
}
