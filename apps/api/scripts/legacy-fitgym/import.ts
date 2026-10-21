/**
 * Import the FitGymSoftware export into the database.
 *
 * Mapping lives in transform.ts; run preview.ts first to see it. This file
 * only writes.
 *
 *   npx tsx scripts/legacy-fitgym/import.ts --plans                 # report
 *   npx tsx scripts/legacy-fitgym/import.ts --plans --commit        # replace plans
 *   npx tsx scripts/legacy-fitgym/import.ts --limit 20 --commit     # test batch
 *   npx tsx scripts/legacy-fitgym/import.ts --only 1,2,6345 --commit
 *   npx tsx scripts/legacy-fitgym/import.ts --all --commit
 *
 * PLANS FIRST. --plans deletes our placeholder plans (refusing if any
 * membership or lead still points at one) and creates the old catalogue.
 * Member imports refuse to run until every old plan exists.
 *
 * ONE TRANSACTION PER MEMBER. A member, their memberships, payments and
 * receipts land together or not at all, so a failure never leaves a member
 * with half a payment history. A member whose ID already exists is skipped,
 * which makes a re-run resume where the last one stopped.
 *
 * PAYMENTS ARE REAL, SO RECEIPTS ARE TOO. Each old payment becomes a Payment
 * plus an Invoice numbered FGS/<old receipt no>, outside our RCPT/ sequence
 * so neither numbering can collide with the other. The two payments the old
 * system recorded without a receipt are imported without one.
 *
 * MEMBER NUMBERS. --plans also points the member counter past the highest
 * old number, so a registration made at the desk mid-import can never take
 * a number an old member is about to be imported with.
 *
 * Uses DIRECT_URL: the transaction pooler hangs on long-running scripts
 * from outside Supabase, and this holds a connection for the whole import.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { env } from '../../src/config/env.js';
import {
  ensurePhotoBucket,
  isSupabaseStorageEnabled,
  uploadPhoto,
} from '../../src/services/storage/supabase-storage.js';
import { BACKUPS, loadLegacy, type MemberRow } from './transform.js';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? env.DATABASE_URL }),
});

const PHOTO_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function importPlans(
  plans: ReturnType<typeof loadLegacy>['plans'],
  highestOldMemberNumber: number,
): Promise<void> {
  const existing = await prisma.plan.findMany({
    include: { _count: { select: { memberships: true, quotedLeads: true } } },
  });
  const oldNames = new Set(plans.map((p) => p.name));
  const placeholders = existing.filter((p) => !oldNames.has(p.name));
  const inUse = placeholders.filter((p) => p._count.memberships > 0 || p._count.quotedLeads > 0);

  console.log(`Delete ${placeholders.length} placeholder plan(s): ${placeholders.map((p) => p.name).join(', ') || '—'}`);
  if (inUse.length) {
    throw new Error(`Refusing: still referenced — ${inUse.map((p) => p.name).join(', ')}`);
  }
  const toCreate = plans.filter((p) => !existing.some((e) => e.name === p.name));
  console.log(`Create ${toCreate.length} plan(s) from the old system.`);
  console.log(`Set the member counter to ${highestOldMemberNumber}; the next registration gets ${highestOldMemberNumber + 1}.`);
  if (!commit) return;

  await prisma.$transaction(async (tx) => {
    await tx.plan.deleteMany({ where: { id: { in: placeholders.map((p) => p.id) } } });
    for (const p of toCreate) {
      await tx.plan.create({
        data: {
          name: p.name,
          description: 'Imported from FitGymSoftware.',
          type: p.type,
          durationDays: p.durationDays,
          pricePaise: p.pricePaise,
          isActive: p.isActive,
          sortOrder: p.sortOrder,
        },
      });
    }
    // Year 0 is the gym-wide counter row (see nextMemberId). GREATEST so a
    // re-run never winds the counter back below numbers already issued.
    await tx.$executeRaw`
      INSERT INTO member_sequences (id, year, "lastSequence", "updatedAt")
      VALUES (${randomUUID()}, 0, ${highestOldMemberNumber}, NOW())
      ON CONFLICT (year) DO UPDATE
      SET "lastSequence" = GREATEST(member_sequences."lastSequence", EXCLUDED."lastSequence"),
          "updatedAt" = NOW()
    `;
  });
  console.log('Plans replaced and member counter set.');
}

async function uploadMemberPhoto(member: MemberRow, photoFiles: Map<string, string>): Promise<string | null> {
  const file = photoFiles.get(member.memberId);
  if (!file) return null;
  const ext = path.extname(file);
  const buffer = await readFile(path.join(BACKUPS, 'photos', file));
  // Same layout as photos taken at the desk: members/<uuid>.<ext>.
  return uploadPhoto(buffer, `members/${randomUUID()}${ext}`, PHOTO_TYPES[ext]!);
}

async function importMember(member: MemberRow, planIds: Map<string, string>, photoUrl: string | null): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const created = await tx.member.create({
        data: {
          memberId: member.memberId,
          fullName: member.fullName,
          phone: member.phone,
          email: member.email,
          dateOfBirth: member.dateOfBirth,
          gender: member.gender,
          photoUrl,
          addressLine1: member.addressLine1,
          emergencyContactPhone: member.emergencyContactPhone,
          medicalNotes: member.medicalNotes,
          notes: member.notes,
          status: member.status,
          joinedAt: member.joinedAt,
        },
      });

      for (const ms of member.memberships) {
        const membership = await tx.membership.create({
          data: {
            memberId: created.id,
            planId: planIds.get(ms.planName)!,
            startDate: ms.startDate,
            endDate: ms.endDate,
            status: ms.status,
            pricePaise: ms.pricePaise,
            discountPaise: ms.discountPaise,
            totalPaise: ms.totalPaise,
            freezeStartDate: ms.freezeStartDate,
            freezeEndDate: ms.freezeEndDate,
            freezeDaysUsed: ms.freezeDaysUsed,
            freezeReason: ms.freezeReason,
            createdAt: ms.startDate,
          },
        });

        for (const pay of ms.payments) {
          const payment = await tx.payment.create({
            data: {
              memberId: created.id,
              membershipId: membership.id,
              amountPaise: pay.amountPaise,
              mode: pay.mode,
              status: 'PAID',
              notes: pay.notes,
              paidAt: pay.paidAt,
              // Re-running can never double-import the same old payment.
              idempotencyKey: pay.key,
              createdAt: pay.paidAt,
            },
          });
          // A payment the old system never receipted gets no receipt here
          // either; inventing a document number would misstate the books.
          if (pay.receiptNumber === null) continue;
          await tx.invoice.create({
            data: {
              invoiceNumber: `FGS/${pay.receiptNumber}`,
              memberId: created.id,
              membershipId: membership.id,
              paymentId: payment.id,
              issuedAt: pay.paidAt,
              subtotalPaise: pay.amountPaise,
              taxablePaise: pay.amountPaise,
              totalPaise: pay.amountPaise,
              snapshot: {
                member: {
                  memberId: member.memberId,
                  fullName: member.fullName,
                  phone: member.phone,
                  email: member.email,
                  addressLine1: member.addressLine1,
                  city: 'Hyderabad',
                  state: 'Telangana',
                  pincode: null,
                },
                paymentMode: pay.mode,
                reference: null,
                legacy: { system: 'FitGymSoftware', receiptNumber: pay.receiptNumber, mode: pay.oldMode },
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
}

async function main(): Promise<void> {
  const legacy = loadLegacy();

  if (args.includes('--plans')) {
    await importPlans(legacy.plans, Math.max(...legacy.members.map((m) => Number(m.memberId))));
    return;
  }

  const plans = await prisma.plan.findMany({ select: { id: true, name: true } });
  const planIds = new Map(plans.map((p) => [p.name, p.id]));
  const missingPlans = legacy.plans.filter((p) => !planIds.has(p.name));
  if (missingPlans.length) throw new Error(`Run --plans first; missing ${missingPlans.map((p) => p.name).join(', ')}`);

  let selected: MemberRow[];
  const only = flag('--only');
  const limit = flag('--limit');
  if (only) {
    const ids = new Set(only.split(','));
    selected = legacy.members.filter((m) => ids.has(m.memberId));
  } else if (limit) {
    selected = legacy.members;
  } else if (args.includes('--all')) {
    selected = legacy.members;
  } else {
    throw new Error('Choose --only <ids>, --limit <n> or --all');
  }

  const notExported = selected.filter((m) => m.warnings.includes('profile not exported yet'));
  if (notExported.length) {
    throw new Error(`${notExported.length} selected member(s) have no exported profile yet; finish the export first`);
  }

  const already = new Set(
    (await prisma.member.findMany({ select: { memberId: true } })).map((m) => m.memberId),
  );
  const pending = selected.filter((m) => !already.has(m.memberId));
  const todo = limit ? pending.slice(0, Number(limit)) : pending;

  const photoFiles = new Map(
    (await readdir(path.join(BACKUPS, 'photos'))).filter((f) => PHOTO_TYPES[path.extname(f)])
      .map((f) => [path.basename(f, path.extname(f)), f]),
  );
  const missingPhotos = todo.filter((m) => m.photoSourceUrl && !photoFiles.has(m.memberId));

  console.log(
    `${selected.length} selected, ${selected.length - pending.length} already imported, ${todo.length} to import` +
      (commit ? '' : ' — dry run, nothing will be written'),
  );
  if (missingPhotos.length) console.log(`  ${missingPhotos.length} photo(s) not downloaded; those members import without one.`);
  if (!commit) return;

  if (todo.some((m) => photoFiles.has(m.memberId))) {
    if (!isSupabaseStorageEnabled()) throw new Error('Supabase Storage is not configured');
    await ensurePhotoBucket();
  }

  let imported = 0;
  const failed: { memberId: string; reason: string }[] = [];
  for (const member of todo) {
    try {
      const photoUrl = await uploadMemberPhoto(member, photoFiles);
      await importMember(member, planIds, photoUrl);
      imported++;
      if (imported % 50 === 0) console.log(`  ${imported}/${todo.length}`);
    } catch (err) {
      failed.push({ memberId: member.memberId, reason: (err as Error).message.slice(0, 300) });
      console.error(`  #${member.memberId} failed: ${(err as Error).message.slice(0, 300)}`);
    }
  }

  await prisma.auditLog.create({
    data: {
      action: 'MEMBERS_IMPORTED',
      entityType: 'Import',
      after: { source: 'FitGymSoftware', imported, failed: failed.length, memberIds: todo.map((m) => m.memberId).slice(0, 50) },
    },
  });

  console.log(`Imported ${imported}, failed ${failed.length}.`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
