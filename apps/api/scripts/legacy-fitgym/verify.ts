/**
 * Check imported members against the export, field by field.
 *
 * For every member already in the database, re-derives what transform.ts
 * says should be there and compares: profile fields, each membership's
 * dates, status and amounts, each payment and its FGS/ receipt. Also checks
 * that every photo URL loads and that the next registration would get the
 * number after the highest old one (inside a transaction that is rolled
 * back, so no number is used up).
 *
 *   npx tsx scripts/legacy-fitgym/verify.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../../src/config/env.js';
import { nextMemberId } from '../../src/lib/sequences.js';
import { loadLegacy } from './transform.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? env.DATABASE_URL }),
});

const problems: string[] = [];
const expectEq = (where: string, field: string, actual: unknown, expected: unknown) => {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const e = expected instanceof Date ? expected.toISOString() : expected;
  if (a !== e) problems.push(`${where} ${field}: got ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`);
};

async function main(): Promise<void> {
  const { members } = loadLegacy();
  const byNumber = new Map(members.map((m) => [m.memberId, m]));

  const imported = await prisma.member.findMany({
    include: {
      memberships: { include: { plan: true, payments: { include: { invoice: true } } }, orderBy: [{ startDate: 'asc' }, { endDate: 'asc' }] },
    },
  });

  let photosChecked = 0;
  for (const dbm of imported) {
    const src = byNumber.get(dbm.memberId);
    const at = `#${dbm.memberId}`;
    if (!src) {
      problems.push(`${at} is in the database but not in the export`);
      continue;
    }
    for (const field of ['fullName', 'phone', 'email', 'dateOfBirth', 'gender', 'addressLine1',
      'emergencyContactPhone', 'medicalNotes', 'notes', 'status', 'joinedAt'] as const) {
      expectEq(at, field, dbm[field], src[field]);
    }
    if (!!dbm.photoUrl !== !!src.photoSourceUrl) problems.push(`${at} photo presence mismatch`);
    if (dbm.photoUrl) {
      const res = await fetch(dbm.photoUrl, { method: 'HEAD' });
      if (!res.ok) problems.push(`${at} photo does not load: HTTP ${res.status}`);
      photosChecked++;
    }

    expectEq(at, 'membership count', dbm.memberships.length, src.memberships.length);
    src.memberships.forEach((sm, i) => {
      const ms = dbm.memberships[i];
      const mat = `${at} membership ${i + 1} (${sm.planName})`;
      if (!ms) return;
      expectEq(mat, 'plan', ms.plan.name, sm.planName);
      for (const field of ['startDate', 'endDate', 'status', 'pricePaise', 'discountPaise', 'totalPaise',
        'freezeStartDate', 'freezeEndDate', 'freezeDaysUsed', 'freezeReason'] as const) {
        expectEq(mat, field, ms[field], sm[field]);
      }
      const paid = ms.payments.reduce((n, p) => n + p.amountPaise, 0);
      expectEq(mat, 'due', Math.max(0, ms.totalPaise - paid), sm.duePaise);
      expectEq(mat, 'payment count', ms.payments.length, sm.payments.length);
      for (const sp of sm.payments) {
        const p = ms.payments.find((x) => x.idempotencyKey === sp.key);
        if (!p) {
          problems.push(`${mat} missing payment ${sp.key}`);
          continue;
        }
        expectEq(`${mat} ${sp.key}`, 'amount', p.amountPaise, sp.amountPaise);
        expectEq(`${mat} ${sp.key}`, 'paidAt', p.paidAt, sp.paidAt);
        expectEq(`${mat} ${sp.key}`, 'mode', p.mode, sp.mode);
        expectEq(`${mat} ${sp.key}`, 'receipt', p.invoice?.invoiceNumber ?? null,
          sp.receiptNumber === null ? null : `FGS/${sp.receiptNumber}`);
      }
    });
  }

  // Never commits: the number is only peeked at.
  let next = '';
  await prisma
    .$transaction(async (tx) => {
      next = await nextMemberId(tx);
      throw new Error('rollback');
    })
    .catch((err: Error) => {
      if (err.message !== 'rollback') throw err;
    });
  const highest = Math.max(...members.map((m) => Number(m.memberId)));
  expectEq('member counter', 'next number', next, String(highest + 1));

  const payments = imported.flatMap((m) => m.memberships.flatMap((s) => s.payments));
  console.log(
    `${imported.length} member(s), ${imported.reduce((n, m) => n + m.memberships.length, 0)} membership(s), ` +
      `${payments.length} payment(s), ${payments.filter((p) => p.invoice).length} receipt(s), ` +
      `${photosChecked} photo(s) loaded; next registration gets #${next}.`,
  );
  if (problems.length) {
    console.log(`${problems.length} problem(s):`);
    for (const p of problems.slice(0, 50)) console.log(`  ${p}`);
    process.exitCode = 1;
  } else {
    console.log('Everything matches the export.');
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
