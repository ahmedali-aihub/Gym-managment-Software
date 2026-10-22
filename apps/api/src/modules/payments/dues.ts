import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Every live member's balance, as a SQL subquery: billed minus paid plus
 * refunded — the arithmetic of calculateBalance — over all their
 * memberships and non-deleted payments. Positive means they owe the gym.
 *
 * Columns: id, "memberId", "fullName", phone, "photoUrl", status, due.
 *
 * The one definition every dues figure is built from, so the dashboard
 * total, the members and payments totals, the "Has dues" list and the
 * defaulters ranking cannot drift apart.
 */
export const MEMBER_BALANCES = Prisma.sql`
  SELECT m.id, m."memberId", m."fullName", m.phone, m."photoUrl", m.status,
         COALESCE(b.billed, 0) - COALESCE(p.paid, 0) + COALESCE(p.refunded, 0)
           AS due
  FROM members m
  LEFT JOIN (
    SELECT "memberId", SUM("totalPaise")::bigint AS billed
    FROM memberships
    GROUP BY "memberId"
  ) b ON b."memberId" = m.id
  LEFT JOIN (
    SELECT "memberId",
           SUM("amountPaise")::bigint AS paid,
           SUM("refundedPaise")::bigint AS refunded
    FROM payments
    WHERE "deletedAt" IS NULL
    GROUP BY "memberId"
  ) p ON p."memberId" = m.id
  WHERE m."deletedAt" IS NULL
`;

/**
 * What members owe the gym in total: the sum of each member's POSITIVE
 * balance, and how many members that is.
 *
 * Not billed-minus-paid across the whole gym. That nets one member's credit
 * against another's debt: on the live data it reported ₹18,750 outstanding
 * while 21 members owed ₹29,050 between them.
 */
export async function getDuesSummary(): Promise<{
  totalPaise: number;
  memberCount: number;
}> {
  const [row] = await prisma.$queryRaw<
    Array<{ total: bigint | number | string; members: bigint | number | string }>
  >`
    SELECT COALESCE(SUM(due), 0) AS total, COUNT(*) AS members
    FROM (${MEMBER_BALANCES}) balances
    WHERE due > 0
  `;

  return {
    totalPaise: Number(row?.total ?? 0),
    memberCount: Number(row?.members ?? 0),
  };
}
