import { Router } from 'express';
import { NotFoundError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { generateReceiptPdf } from '../../services/pdf/receipt.service.js';

const router = Router();

router.use(authenticate);

/**
 * Stream a receipt PDF.
 *
 * Generated on demand rather than stored at payment time: a receipt is read
 * rarely, and regenerating from the invoice's snapshot guarantees the
 * document always matches the record. It also means a change to the layout
 * applies to every past receipt without a backfill.
 */
router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const id = req.params.id as string;

    const exists = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, invoiceNumber: true },
    });

    if (!exists) throw new NotFoundError('Receipt');

    const { buffer, filename } = await generateReceiptPdf(id);

    res.setHeader('Content-Type', 'application/pdf');
    // `inline` opens in the browser's viewer; staff usually want to look
    // before printing, and a forced download interrupts that.
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.byteLength);
    res.send(buffer);
  }),
);

/** Look the receipt up by the payment it belongs to. */
router.get(
  '/by-payment/:paymentId',
  asyncHandler(async (req, res) => {
    const invoice = await prisma.invoice.findUnique({
      where: { paymentId: req.params.paymentId as string },
      select: { id: true, invoiceNumber: true, issuedAt: true, totalPaise: true },
    });

    if (!invoice) throw new NotFoundError('Receipt');

    res.json({ success: true, data: invoice });
  }),
);

export { router as invoicesRoutes };
