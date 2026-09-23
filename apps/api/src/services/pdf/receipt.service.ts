import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  amountInWords,
  formatDate,
  formatINR,
  formatPhone,
} from '@azf/shared';
import PDFDocument from 'pdfkit';
import { env, gymConfig } from '../../config/env.js';
import { moduleLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';

const log = moduleLogger('pdf:receipt');

/**
 * Receipt / invoice PDF generation.
 *
 * A to Z Fitness is not GST registered, so this produces a plain receipt with
 * no tax lines. The GST branches are live code rather than placeholders — the
 * same function issues a compliant tax invoice the moment GST_REGISTERED
 * flips, with CGST/SGST split and SAC code.
 *
 * Everything is drawn from the invoice's stored `snapshot`, never from the
 * member's current record. A receipt reprinted in three years must show the
 * name and address as they were at issue, not as they are today — that is
 * what makes it a document rather than a view.
 */

interface ReceiptSnapshot {
  member?: {
    memberId?: string;
    fullName?: string;
    phone?: string;
    email?: string | null;
    addressLine1?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
  };
  paymentMode?: string;
  reference?: string | null;
}

const COLORS = {
  ink: '#1c1917',
  muted: '#78716c',
  line: '#e7e5e4',
  accent: '#8a6642',
} as const;

const PAGE_MARGIN = 48;
const LOGO_SIZE = 58;

/**
 * Render an amount for PDF output.
 *
 * PDFKit's built-in Helvetica has no rupee glyph in WinAnsi encoding, so a
 * literal ₹ prints as a superscript one. A non-breaking space keeps "Rs."
 * attached to its number when a line wraps.
 */
function money(paise: number): string {
  return formatINR(paise).replace(/₹/g, 'Rs. ');
}

/**
 * Gym logo, loaded once and cached.
 *
 * Read from the web app's public directory so there is a single copy to
 * maintain — replacing logo.png updates the screen and the receipt together.
 *
 * `null` means "checked and unavailable", which is cached too: a missing file
 * would otherwise be re-read on every receipt.
 */
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

  log.warn('Gym logo not found; receipts will print without it');
  logoCache = null;
  return null;
}

/**
 * A faint centred logo behind the receipt content.
 *
 * `save`/`restore` brackets the whole operation because opacity and the
 * transform are document-level state in PDFKit — leaking either would tint
 * or rotate everything drawn afterwards.
 *
 * Falls back to wordmark text when the logo file is missing, so the paper is
 * still marked rather than silently plain.
 */
async function drawWatermark(doc: PDFKit.PDFDocument): Promise<void> {
  const logo = await loadLogo();
  const centreX = doc.page.width / 2;
  const centreY = doc.page.height / 2;

  doc.save();

  if (logo) {
    // Smaller and fainter than instinct suggests. At 320px/0.05 the
    // wordmark inside the logo stayed legible and sat directly behind the
    // line items — a watermark that can be READ competes with the figures
    // instead of marking the paper.
    const size = 240;
    doc.opacity(0.028);
    doc.image(logo, centreX - size / 2, centreY - size / 2, {
      fit: [size, size],
      align: 'center',
      valign: 'center',
    });
  } else {
    doc.opacity(0.04);
    doc.rotate(-30, { origin: [centreX, centreY] });
    doc
      .font('Helvetica-Bold')
      .fontSize(72)
      .fillColor(COLORS.accent)
      .text(gymConfig.name.toUpperCase(), 0, centreY - 40, {
        width: doc.page.width,
        align: 'center',
      });
  }

  doc.restore();
  // restore() returns opacity and transform to their defaults, but the fill
  // colour is set separately and would otherwise persist into the header.
  doc.opacity(1).fillColor(COLORS.ink);
}

export async function generateReceiptPdf(invoiceId: string): Promise<{
  buffer: Buffer;
  filename: string;
}> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      member: {
        select: { memberId: true, fullName: true, phone: true, email: true },
      },
      membership: {
        select: {
          startDate: true,
          endDate: true,
          plan: { select: { name: true } },
        },
      },
      payment: { select: { mode: true, reference: true, paidAt: true } },
    },
  });

  const snapshot = (invoice.snapshot ?? {}) as ReceiptSnapshot;
  const member = snapshot.member ?? invoice.member;

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    info: {
      Title: invoice.invoiceNumber,
      Author: gymConfig.name,
      Subject: invoice.isGstInvoice ? 'Tax Invoice' : 'Payment Receipt',
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const width = doc.page.width - PAGE_MARGIN * 2;

  // ── Watermark ───────────────────────────────────────────────────────
  //
  // Drawn FIRST so every later element paints over it; PDF has no
  // z-index, only draw order. Very low opacity: a watermark that competes
  // with the figures makes the document harder to read, and the point is
  // to mark the paper, not to decorate it.
  await drawWatermark(doc);

  let y = PAGE_MARGIN;

  // ── Header ──────────────────────────────────────────────────────────
  //
  // The logo is optional: a missing or unreadable file must never stop a
  // receipt printing, so failure falls back to text-only and the member
  // still walks away with proof of payment.
  const logo = await loadLogo();
  const textX = logo ? PAGE_MARGIN + LOGO_SIZE + 12 : PAGE_MARGIN;

  if (logo) {
    try {
      // `fit` preserves aspect ratio within the box; left alignment is the
      // default, and PDFKit's types reject it as an explicit value.
      doc.image(logo, PAGE_MARGIN, y, { fit: [LOGO_SIZE, LOGO_SIZE] });
    } catch {
      // Corrupt image data; continue without it.
    }
  }

  doc
    .fillColor(COLORS.ink)
    .fontSize(18)
    .font('Helvetica-Bold')
    .text(gymConfig.name, textX, y + 2);

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(gymConfig.addressLine1, textX, y + 26)
    .text(gymConfig.addressLine2, textX, y + 38)
    .text(`${formatPhone(gymConfig.phone)}  ·  ${gymConfig.email}`, textX, y + 50);

  if (invoice.isGstInvoice && invoice.gstin) {
    doc.text(`GSTIN: ${invoice.gstin}`, textX, y + 62);
  }

  // Document type, right-aligned.
  doc
    .fillColor(COLORS.accent)
    .fontSize(13)
    .font('Helvetica-Bold')
    .text(
      invoice.isGstInvoice ? 'TAX INVOICE' : 'PAYMENT RECEIPT',
      PAGE_MARGIN,
      y + 2,
      { width, align: 'right' },
    );

  doc
    .fillColor(COLORS.ink)
    .fontSize(10)
    .font('Helvetica-Bold')
    .text(invoice.invoiceNumber, PAGE_MARGIN, y + 22, {
      width,
      align: 'right',
    });

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(formatDate(invoice.issuedAt), PAGE_MARGIN, y + 36, {
      width,
      align: 'right',
    });

  y += 88;

  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + width, y)
    .strokeColor(COLORS.line)
    .lineWidth(1)
    .stroke();

  y += 20;

  // ── Billed to ───────────────────────────────────────────────────────
  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('BILLED TO', PAGE_MARGIN, y);

  doc
    .fillColor(COLORS.ink)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text(member.fullName ?? '—', PAGE_MARGIN, y + 14);

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(`Member ID: ${member.memberId ?? '—'}`, PAGE_MARGIN, y + 30);

  if (member.phone) {
    doc.text(formatPhone(member.phone), PAGE_MARGIN, y + 42);
  }

  const address = [
    snapshot.member?.addressLine1,
    snapshot.member?.city,
    snapshot.member?.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  if (address) {
    doc.text(address, PAGE_MARGIN, y + 54, { width: width * 0.5 });
  }

  // Payment details, right column.
  const rightX = PAGE_MARGIN + width * 0.55;

  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('PAYMENT', rightX, y);

  doc
    .fillColor(COLORS.ink)
    .fontSize(9)
    .font('Helvetica')
    .text(
      `Mode: ${snapshot.paymentMode ?? invoice.payment?.mode ?? '—'}`,
      rightX,
      y + 14,
    );

  const reference = snapshot.reference ?? invoice.payment?.reference;
  if (reference) {
    doc.text(`Reference: ${reference}`, rightX, y + 26);
  }

  y += 82;

  // ── Line items ──────────────────────────────────────────────────────
  const tableTop = y;
  const colDescription = PAGE_MARGIN + 8;

  doc.rect(PAGE_MARGIN, tableTop, width, 24).fill('#faf9f7');

  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('DESCRIPTION', colDescription, tableTop + 8)
    .text('AMOUNT', PAGE_MARGIN, tableTop + 8, {
      width: width - 8,
      align: 'right',
    });

  y = tableTop + 24;

  const planName = invoice.membership?.plan.name ?? 'Membership';

  doc
    .fillColor(COLORS.ink)
    .fontSize(10)
    .font('Helvetica')
    .text(planName, colDescription, y + 10);

  // The period this payment bought. Without it the member has proof they
  // paid but no record of what they paid FOR, which is the first thing
  // anyone checks when a renewal date is disputed.
  const period =
    invoice.membership?.startDate && invoice.membership.endDate
      ? `Valid ${formatDate(invoice.membership.startDate)} to ${formatDate(invoice.membership.endDate)}`
      : null;

  if (period) {
    doc
      .fillColor(COLORS.muted)
      .fontSize(8.5)
      .text(period, colDescription, y + 25);
  }

  if (invoice.isGstInvoice && invoice.sacCode) {
    doc
      .fillColor(COLORS.muted)
      .fontSize(8)
      .text(`SAC ${invoice.sacCode}`, colDescription, period ? y + 37 : y + 24);
  }

  doc
    .fillColor(COLORS.ink)
    .fontSize(10)
    .text(
      money(invoice.subtotalPaise),
      PAGE_MARGIN,
      y + 10,
      { width: width - 8, align: 'right' },
    );

  y += period ? 56 : 44;

  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + width, y)
    .strokeColor(COLORS.line)
    .stroke();

  y += 12;

  // ── Totals ──────────────────────────────────────────────────────────
  const totalsX = PAGE_MARGIN + width * 0.55;
  const totalsWidth = width * 0.45 - 8;

  function totalRow(
    label: string,
    amountPaise: number,
    options: { bold?: boolean; negative?: boolean } = {},
  ) {
    doc
      .fillColor(options.bold ? COLORS.ink : COLORS.muted)
      .fontSize(options.bold ? 11 : 9)
      .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, totalsX, y);

    doc.text(
      `${options.negative ? '- ' : ''}${money(amountPaise)}`,
      totalsX,
      y,
      { width: totalsWidth, align: 'right' },
    );

    y += options.bold ? 20 : 16;
  }

  if (invoice.discountPaise > 0) {
    totalRow('Subtotal', invoice.subtotalPaise);
    totalRow('Discount', invoice.discountPaise, { negative: true });
  }

  // Tax lines appear only when GST-registered; otherwise this is a receipt.
  if (invoice.isGstInvoice) {
    totalRow('Taxable value', invoice.taxablePaise);

    const halfRate = invoice.gstRate / 2;
    if (invoice.cgstPaise > 0) {
      totalRow(`CGST @ ${halfRate}%`, invoice.cgstPaise);
    }
    if (invoice.sgstPaise > 0) {
      totalRow(`SGST @ ${halfRate}%`, invoice.sgstPaise);
    }
    if (invoice.igstPaise > 0) {
      totalRow(`IGST @ ${invoice.gstRate}%`, invoice.igstPaise);
    }
  }

  y += 4;
  doc
    .moveTo(totalsX, y)
    .lineTo(PAGE_MARGIN + width, y)
    .strokeColor(COLORS.line)
    .stroke();
  y += 10;

  totalRow('Total paid', invoice.totalPaise, { bold: true });

  // ── Amount in words ─────────────────────────────────────────────────
  y += 8;
  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica-Bold')
    .text('AMOUNT IN WORDS', PAGE_MARGIN, y);

  doc
    .fillColor(COLORS.ink)
    .fontSize(9)
    .font('Helvetica-Oblique')
    .text(amountInWords(invoice.totalPaise), PAGE_MARGIN, y + 13, {
      width: width * 0.5,
    });

  // ── Thank-you panel ─────────────────────────────────────────────────
  //
  // Fills what was two-thirds of an empty page, and carries the one thing a
  // member actually acts on: when to renew, and who to call. A receipt that
  // ends in blank paper reads as unfinished.
  y += 44;

  const panelHeight = 74;
  doc
    .roundedRect(PAGE_MARGIN, y, width, panelHeight, 8)
    .fillColor('#faf8f5')
    .fill();

  doc
    .fillColor(COLORS.accent)
    .fontSize(11)
    .font('Helvetica-Bold')
    .text('Thank you for your payment', PAGE_MARGIN + 18, y + 16);

  const renewalNote =
    invoice.membership?.endDate
      ? `Your membership is valid until ${formatDate(invoice.membership.endDate)}. Renew on or before this date to keep training without a break.`
      : 'Keep this receipt for your records.';

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .font('Helvetica')
    .text(renewalNote, PAGE_MARGIN + 18, y + 34, { width: width - 36 });

  doc
    .fillColor(COLORS.muted)
    .fontSize(9)
    .text(
      `Questions? Call ${gymConfig.phone}`,
      PAGE_MARGIN + 18,
      y + panelHeight - 20,
      { width: width - 36 },
    );

  // ── Footer ──────────────────────────────────────────────────────────
  const footerY = doc.page.height - PAGE_MARGIN - 54;

  doc
    .moveTo(PAGE_MARGIN, footerY)
    .lineTo(PAGE_MARGIN + width, footerY)
    .strokeColor(COLORS.line)
    .stroke();

  doc
    .fillColor(COLORS.muted)
    .fontSize(8)
    .font('Helvetica')
    .text(
      // No GST note. A plain receipt from an unregistered business does not
      // need to announce that — it draws attention to the gym's turnover
      // and means nothing to the member holding it.
      invoice.isGstInvoice
        ? 'This is a computer-generated tax invoice and does not require a signature.'
        : 'This is a computer-generated receipt and does not require a signature.',
      PAGE_MARGIN,
      footerY + 12,
      { width, align: 'center' },
    );

  doc.text(
    `${gymConfig.name} · ${gymConfig.addressLine1}, ${gymConfig.addressLine2}`,
    PAGE_MARGIN,
    footerY + 26,
    { width, align: 'center' },
  );

  doc.end();

  const buffer = await done;
  const filename = `${invoice.invoiceNumber.replace(/\//g, '-')}.pdf`;

  log.debug({ invoiceId, filename }, 'Receipt PDF generated');

  return { buffer, filename };
}

/**
 * Generate and persist a receipt, storing its public URL on the invoice.
 * Returns the URL so callers can link to it immediately.
 */
export async function storeReceiptPdf(invoiceId: string): Promise<string> {
  const { buffer, filename } = await generateReceiptPdf(invoiceId);

  const directory = path.resolve(env.UPLOAD_DIR, 'invoices');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), buffer);

  const url = `/uploads/invoices/${filename}`;

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { pdfUrl: url },
  });

  return url;
}
