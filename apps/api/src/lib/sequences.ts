import {
  financialYear,
  formatInvoiceNumber,
  formatMemberId,
  formatReceiptNumber,
} from '@azf/shared';
import type { Prisma } from '@prisma/client';

/**
 * Gap-free sequential identifiers.
 *
 * Member IDs and invoice numbers must be sequential with no duplicates and no
 * gaps — an accountant reading INV/2026-27/0001 … 0050 expects exactly fifty
 * invoices.
 *
 * A naive `MAX(sequence) + 1` read-then-write has a race: two registrations
 * arriving together both read 41 and both write 42. Postgres sequences do not
 * fix it either, since they deliberately leak numbers on rollback.
 *
 * The approach used here is an atomic `UPDATE ... RETURNING` on a single
 * counter row, which takes a row-level lock for the duration of the enclosing
 * transaction. Concurrent callers queue behind it and receive distinct values;
 * if the transaction rolls back, so does the increment — hence no gaps.
 *
 * Every function here MUST be called inside a transaction, which is why each
 * takes a `tx` client rather than reaching for the global one.
 */

/**
 * Next member ID for the current calendar year, e.g. AZF-2026-0001.
 * Resets each January.
 */
export async function nextMemberId(
  tx: Prisma.TransactionClient,
  year: number = new Date().getFullYear(),
): Promise<string> {
  // upsert seeds the counter the first time a year is used; the atomic
  // increment then hands out one value per caller.
  await tx.memberSequence.upsert({
    where: { year },
    create: { year, lastSequence: 0 },
    update: {},
  });

  const [row] = await tx.$queryRaw<Array<{ lastSequence: number }>>`
    UPDATE member_sequences
    SET "lastSequence" = "lastSequence" + 1,
        "updatedAt" = NOW()
    WHERE year = ${year}
    RETURNING "lastSequence"
  `;

  if (!row) {
    throw new Error(`Failed to allocate a member ID for ${year}`);
  }

  return formatMemberId(year, row.lastSequence);
}

/**
 * Next invoice number for the Indian financial year (1 Apr – 31 Mar),
 * e.g. INV/2026-27/0001.
 */
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  issuedAt: Date = new Date(),
): Promise<string> {
  const fy = financialYear(issuedAt);

  await tx.invoiceSequence.upsert({
    where: { financialYear: fy },
    create: { financialYear: fy, lastSequence: 0 },
    update: {},
  });

  const [row] = await tx.$queryRaw<Array<{ lastSequence: number }>>`
    UPDATE invoice_sequences
    SET "lastSequence" = "lastSequence" + 1,
        "updatedAt" = NOW()
    WHERE "financialYear" = ${fy}
    RETURNING "lastSequence"
  `;

  if (!row) {
    throw new Error(`Failed to allocate an invoice number for ${fy}`);
  }

  return formatInvoiceNumber(fy, row.lastSequence);
}

/**
 * Receipt number, drawn from the same financial-year counter as invoices.
 *
 * A to Z Fitness is not GST registered, so documents are issued as receipts
 * (RCPT/...) rather than tax invoices (INV/...). Sharing one counter keeps the
 * numbering continuous if the gym registers for GST mid-year and the prefix
 * changes — the sequence does not restart, which is what an auditor expects.
 */
export async function nextReceiptNumber(
  tx: Prisma.TransactionClient,
  issuedAt: Date = new Date(),
): Promise<string> {
  const fy = financialYear(issuedAt);

  await tx.invoiceSequence.upsert({
    where: { financialYear: fy },
    create: { financialYear: fy, lastSequence: 0 },
    update: {},
  });

  const [row] = await tx.$queryRaw<Array<{ lastSequence: number }>>`
    UPDATE invoice_sequences
    SET "lastSequence" = "lastSequence" + 1,
        "updatedAt" = NOW()
    WHERE "financialYear" = ${fy}
    RETURNING "lastSequence"
  `;

  if (!row) {
    throw new Error(`Failed to allocate a receipt number for ${fy}`);
  }

  return formatReceiptNumber(fy, row.lastSequence);
}

/**
 * Document number appropriate to the current tax registration:
 * a tax invoice when GST-registered, a plain receipt otherwise.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  isGstRegistered: boolean,
  issuedAt: Date = new Date(),
): Promise<string> {
  return isGstRegistered
    ? nextInvoiceNumber(tx, issuedAt)
    : nextReceiptNumber(tx, issuedAt);
}
