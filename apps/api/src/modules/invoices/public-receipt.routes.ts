import { Router } from 'express';
import { NotFoundError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { invoiceIdFromToken } from '../../lib/receipt-link.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { generateReceiptPdf } from '../../services/pdf/receipt.service.js';

const router = Router();

/**
 * A member's receipt, opened from the link in their WhatsApp message.
 *
 * Deliberately public — the member has no login — and safe only because
 * the token is signed (see lib/receipt-link). A forged token and a missing
 * receipt get the same 404, so the endpoint reveals nothing about which
 * receipts exist.
 */
router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const invoiceId = invoiceIdFromToken(req.params.token as string);
    if (!invoiceId) throw new NotFoundError('Receipt');

    const exists = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundError('Receipt');

    const { buffer, filename } = await generateReceiptPdf(invoiceId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.byteLength);
    // Personal data: never cached by a shared proxy, never indexed.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(buffer);
  }),
);

export { router as publicReceiptRoutes };
