import type { Prisma } from '@prisma/client';
import { taxConfig } from '../../config/env.js';
import { nextDocumentNumber } from '../../lib/sequences.js';

/**
 * Issue the receipt document for a payment.
 *
 * SHARED BY BOTH PAYMENT PATHS. Registration and the payments screen each
 * take money, and both must produce a document from the same gap-free
 * sequence. This used to live privately inside the payments service, so a
 * registration payment got no receipt at all — the member paid ₹4,000 and
 * had nothing to show for it, and the welcome email had no PDF to attach.
 *
 * Runs INSIDE the caller's transaction. The document number comes from a
 * row-locked sequence, so issuing it outside the transaction that creates
 * the payment would allow a number to be consumed by a payment that then
 * rolls back, leaving a permanent gap in the book.
 *
 * A to Z Fitness is not GST registered, so this issues a plain receipt
 * (RCPT/...) with zero tax. The snapshot captures member identity at issue
 * time so a reprint years later is faithful even if the member has since
 * changed their name or address.
 */
export async function issueReceipt(
  tx: Prisma.TransactionClient,
  paymentId: string,
  memberId: string,
  membershipId: string | null,
): Promise<void> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
  });

  const member = await tx.member.findUniqueOrThrow({
    where: { id: memberId },
    select: {
      memberId: true,
      fullName: true,
      phone: true,
      email: true,
      addressLine1: true,
      city: true,
      state: true,
      pincode: true,
    },
  });

  const documentNumber = await nextDocumentNumber(
    tx,
    taxConfig.isRegistered,
    payment.paidAt,
  );

  await tx.invoice.create({
    data: {
      invoiceNumber: documentNumber,
      memberId,
      membershipId,
      paymentId,
      issuedAt: payment.paidAt,
      subtotalPaise: payment.amountPaise,
      discountPaise: payment.discountPaise,
      taxablePaise: payment.amountPaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      totalPaise: payment.amountPaise,
      gstRate: taxConfig.rate,
      gstin: taxConfig.gstin,
      sacCode: taxConfig.isRegistered ? taxConfig.sacCode : null,
      isGstInvoice: taxConfig.isRegistered,
      snapshot: {
        member,
        paymentMode: payment.mode,
        reference: payment.reference,
      } as Prisma.InputJsonValue,
    },
  });
}
