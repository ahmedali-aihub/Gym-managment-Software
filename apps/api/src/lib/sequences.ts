import {
  financialYear,
  formatInvoiceNumber,
  formatMemberId,
  formatReceiptNumber,
} from '@azf/shared';
import { randomUUID } from 'node:crypto';
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
 * The member ID counter is a single gym-wide row. It reuses the
 * member_sequences table, which was keyed by calendar year when IDs looked
 * like AZF-2026-0001; year 0 is that one row, so no migration was needed.
 */
const MEMBER_COUNTER_ROW = 0;

/**
 * Next member ID, e.g. 6373 — one past the highest ever issued.
 */
export async function nextMemberId(
  tx: Prisma.TransactionClient,
): Promise<string> {
  // The first call seeds the counter from the highest numeric ID already in
  // the table rather than from zero. Imported members keep their old
  // numbers, and a counter starting at 0 would hand out #1 a second time.
  await tx.$executeRaw`
    INSERT INTO member_sequences (id, year, "lastSequence", "updatedAt")
    SELECT ${randomUUID()}, ${MEMBER_COUNTER_ROW},
           COALESCE(MAX("memberId"::int), 0), NOW()
    FROM members
    WHERE "memberId" ~ '^[0-9]+$'
    ON CONFLICT (year) DO NOTHING
  `;

  const [row] = await tx.$queryRaw<Array<{ lastSequence: number }>>`
    UPDATE member_sequences
    SET "lastSequence" = "lastSequence" + 1,
        "updatedAt" = NOW()
    WHERE year = ${MEMBER_COUNTER_ROW}
    RETURNING "lastSequence"
  `;

  if (!row) {
    throw new Error('Failed to allocate a member ID');
  }

  return formatMemberId(row.lastSequence);
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
 * Give back document numbers whose documents an undo has just removed.
 *
 * Only from the TOP of the counter: RCPT/2026-27/0007 is released only while
 * 0007 is still the last number issued that year. Once 0008 exists, lowering
 * the counter would hand out 0008 twice, so the removed number stays a gap —
 * a visible gap is an accounting question, a duplicate is an error.
 *
 * The check and the decrement are one conditional UPDATE, so a receipt
 * issued concurrently cannot slip between them. Returns the numbers that
 * were released. MUST run inside the transaction that deleted the documents.
 */
export async function releaseDocumentNumbers(
  tx: Prisma.TransactionClient,
  numbers: string[],
): Promise<string[]> {
  const parsed = numbers
    .map((number) => {
      const match = /^[A-Z]+\/(\d{4}-\d{2})\/(\d+)$/.exec(number);
      return match
        ? { number, financialYear: match[1]!, sequence: Number(match[2]) }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    // Highest first, so two removed receipts at the top both come back.
    .sort((a, b) => b.sequence - a.sequence);

  const released: string[] = [];
  for (const entry of parsed) {
    const updated = await tx.$executeRaw`
      UPDATE invoice_sequences
      SET "lastSequence" = "lastSequence" - 1,
          "updatedAt" = NOW()
      WHERE "financialYear" = ${entry.financialYear}
        AND "lastSequence" = ${entry.sequence}
    `;
    if (updated === 1) released.push(entry.number);
  }
  return released;
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
