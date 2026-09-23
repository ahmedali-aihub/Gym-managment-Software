import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CERTIFICATIONS,
  EMERGENCY_RELATIONS,
  FEMALE_FIRST_NAMES,
  HYDERABAD_LOCALITIES,
  MALE_FIRST_NAMES,
  SEED_PLANS,
  STREET_NAMES,
  SURNAMES,
  TRAINER_SPECIALIZATIONS,
} from './seed-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
});
const prisma = new PrismaClient({ adapter });

/**
 * Demo seed: 200 members with a realistic distribution of statuses,
 * plans, payment histories and attendance.
 *
 * "Realistic" is doing real work here. A seed where every member is active
 * and fully paid makes the dashboard look wonderful and tells you nothing.
 * This one deliberately includes expired members, partial payments,
 * defaulters, frozen memberships and lapsed attendance — so every KPI,
 * filter and empty state has something to show.
 */

const MEMBER_COUNT = 200;

// Deterministic PRNG so repeated seeds produce identical data. Debugging a
// dashboard against a member list that changes on every reseed is miserable.
let seedState = 20260919;
function random(): number {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}

function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function pickMany<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
  }
  return chosen;
}

function chance(probability: number): boolean {
  return random() < probability;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/** Unique 10-digit Indian mobile numbers, starting 6–9. */
const usedPhones = new Set<string>();
function generatePhone(): string {
  let phone: string;
  do {
    const prefix = pick(['6', '7', '8', '9']);
    phone = prefix + String(randomInt(100000000, 999999999)).padStart(9, '0');
  } while (usedPhones.has(phone));
  usedPhones.add(phone);
  return phone;
}

const FITNESS_GOALS = [
  'WEIGHT_LOSS', 'MUSCLE_GAIN', 'GENERAL_FITNESS', 'STRENGTH',
  'ENDURANCE', 'FLEXIBILITY', 'SPORTS_TRAINING', 'REHABILITATION',
] as const;

async function main(): Promise<void> {
  console.log('\n🌱 Seeding A to Z Fitness demo data\n');

  // ── Clear existing data ────────────────────────────────────────────────
  // Order matters: children before parents, or foreign keys reject the delete.
  console.log('  Clearing existing data...');
  await prisma.attendance.deleteMany();
  await prisma.smsLog.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.membershipEvent.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.member.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.trainerProfile.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.invoiceSequence.deleteMany();
  await prisma.memberSequence.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.setting.deleteMany();

  // ── Staff ──────────────────────────────────────────────────────────────
  console.log('  Creating staff accounts...');
  const passwordHash = await bcrypt.hash('Password123', 10);

  const owner = await prisma.user.create({
    data: {
      fullName: 'Mohammed Azharuddin',
      email: 'owner@atozfitness.in',
      phone: '9876500001',
      passwordHash,
      role: 'OWNER',
      isActive: true,
    },
  });

  const manager = await prisma.user.create({
    data: {
      fullName: 'Srinivas Reddy',
      email: 'manager@atozfitness.in',
      phone: '9876500002',
      passwordHash,
      role: 'MANAGER',
      isActive: true,
    },
  });

  const receptionist = await prisma.user.create({
    data: {
      fullName: 'Priya Sharma',
      email: 'reception@atozfitness.in',
      phone: '9876500003',
      passwordHash,
      role: 'RECEPTIONIST',
      isActive: true,
    },
  });

  const trainerSeeds = [
    { name: 'Imran Khan', email: 'imran@atozfitness.in', phone: '9876500004' },
    { name: 'Rakesh Goud', email: 'rakesh@atozfitness.in', phone: '9876500005' },
    { name: 'Swathi Nair', email: 'swathi@atozfitness.in', phone: '9876500006' },
    { name: 'Vikram Singh', email: 'vikram@atozfitness.in', phone: '9876500007' },
    { name: 'Deepika Rao', email: 'deepika@atozfitness.in', phone: '9876500008' },
  ];

  const trainers = [];
  for (const [index, seed] of trainerSeeds.entries()) {
    const user = await prisma.user.create({
      data: {
        fullName: seed.name,
        email: seed.email,
        phone: seed.phone,
        passwordHash,
        role: 'TRAINER',
        isActive: true,
      },
    });

    const profile = await prisma.trainerProfile.create({
      data: {
        userId: user.id,
        specialization: [...(TRAINER_SPECIALIZATIONS[index] ?? [])],
        bio: `Certified trainer specialising in ${TRAINER_SPECIALIZATIONS[index]?.[0] ?? 'fitness'}.`,
        experienceYears: randomInt(2, 12),
        certifications: pickMany(CERTIFICATIONS, randomInt(1, 3)),
        commissionPercent: randomInt(5, 15),
        monthlySalaryPaise: randomInt(180, 350) * 100 * 100,
      },
    });

    trainers.push(profile);
  }

  console.log(`    ✓ ${3 + trainers.length} staff accounts`);

  // ── Plans ──────────────────────────────────────────────────────────────
  console.log('  Creating membership plans...');
  const plans = [];
  for (const plan of SEED_PLANS) {
    plans.push(
      await prisma.plan.create({
        data: {
          name: plan.name,
          description: plan.description,
          type: plan.type,
          durationDays: plan.durationDays,
          pricePaise: plan.pricePaise,
          joiningFeePaise: plan.joiningFeePaise,
          maxFreezeDays: plan.maxFreezeDays,
          features: [...plan.features],
          sortOrder: plan.sortOrder,
          isActive: true,
        },
      }),
    );
  }
  console.log(`    ✓ ${plans.length} plans`);

  // ── Members ────────────────────────────────────────────────────────────
  console.log(`  Creating ${MEMBER_COUNT} members...`);

  const now = new Date();
  const currentYear = now.getFullYear();

  // Weighted so popular plans dominate, as they would in reality.
  const planWeights = [
    { plan: plans[0]!, weight: 30 }, // Monthly
    { plan: plans[1]!, weight: 28 }, // Quarterly
    { plan: plans[2]!, weight: 18 }, // Half-yearly
    { plan: plans[3]!, weight: 12 }, // Yearly
    { plan: plans[4]!, weight: 8 },  // Student
    { plan: plans[5]!, weight: 4 },  // Couple
  ];
  const totalWeight = planWeights.reduce((sum, p) => sum + p.weight, 0);

  function pickPlan() {
    let roll = random() * totalWeight;
    for (const entry of planWeights) {
      roll -= entry.weight;
      if (roll <= 0) return entry.plan;
    }
    return planWeights[0]!.plan;
  }

  let memberSequence = 0;
  const createdMembers: Array<{
    id: string;
    memberId: string;
    membershipId: string;
    startDate: Date;
    endDate: Date;
    status: string;
  }> = [];

  for (let i = 0; i < MEMBER_COUNT; i++) {
    const gender = chance(0.62) ? 'MALE' : 'FEMALE';
    const firstName = gender === 'MALE'
      ? pick(MALE_FIRST_NAMES)
      : pick(FEMALE_FIRST_NAMES);
    const fullName = `${firstName} ${pick(SURNAMES)}`;

    const locality = pick(HYDERABAD_LOCALITIES);
    const plan = pickPlan();

    // Joined at some point in the last 14 months, weighted toward recent —
    // a growing gym has more recent joins than old ones.
    const daysAgo = Math.floor(Math.pow(random(), 1.6) * 420);
    const joinedAt = startOfDay(addDays(now, -daysAgo));
    const endDate = endOfDay(addDays(joinedAt, plan.durationDays - 1));

    /**
     * Status reflects what the membership dates actually say, with a few
     * deliberate frozen and cancelled cases mixed in. Deriving status from
     * dates rather than assigning it randomly keeps the data self-consistent:
     * no "active" member with an expiry date in 2025.
     */
    let status: 'ACTIVE' | 'EXPIRED' | 'FROZEN' | 'CANCELLED';
    let membershipStatus: 'ACTIVE' | 'EXPIRED' | 'FROZEN' | 'CANCELLED';

    if (endDate < now) {
      status = chance(0.08) ? 'CANCELLED' : 'EXPIRED';
      membershipStatus = status === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED';
    } else if (chance(0.05) && plan.maxFreezeDays > 0) {
      status = 'FROZEN';
      membershipStatus = 'FROZEN';
    } else {
      status = 'ACTIVE';
      membershipStatus = 'ACTIVE';
    }

    const age = randomInt(16, 58);
    const dateOfBirth = new Date(
      currentYear - age,
      randomInt(0, 11),
      randomInt(1, 28),
    );

    const memberId = `AZF-${joinedAt.getFullYear()}-${String(++memberSequence).padStart(4, '0')}`;

    // Discount on roughly one in six memberships, as a real gym would give.
    const discountPaise = chance(0.17)
      ? Math.round((plan.pricePaise * randomInt(5, 20)) / 100 / 100) * 100
      : 0;

    const joiningFeePaise = plan.joiningFeePaise;
    const totalPaise = plan.pricePaise + joiningFeePaise - discountPaise;

    const member = await prisma.member.create({
      data: {
        memberId,
        fullName,
        phone: generatePhone(),
        email: chance(0.55)
          ? `${firstName.toLowerCase()}.${randomInt(10, 999)}@gmail.com`
          : null,
        dateOfBirth,
        gender,
        addressLine1: `${randomInt(1, 99)}-${randomInt(1, 199)}, ${pick(STREET_NAMES)}`,
        addressLine2: locality.area,
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: locality.pincode,
        emergencyContactName: chance(0.72)
          ? `${pick(chance(0.5) ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES)} ${pick(SURNAMES)}`
          : null,
        emergencyContactPhone: chance(0.72) ? generatePhone() : null,
        emergencyContactRelation: chance(0.72) ? pick(EMERGENCY_RELATIONS) : null,
        goals: pickMany(FITNESS_GOALS, randomInt(1, 3)),
        medicalNotes: chance(0.12)
          ? pick([
              'Mild asthma — avoid prolonged high-intensity cardio.',
              'Previous knee injury (right). No deep squats.',
              'Hypertension, on medication.',
              'Lower back pain. Avoid heavy deadlifts.',
              'Type 2 diabetes — monitor during long sessions.',
            ])
          : null,
        status,
        joinedAt,
        trainerId: chance(0.42) ? pick(trainers).id : null,
        createdById: chance(0.7) ? receptionist.id : manager.id,
      },
    });

    const membership = await prisma.membership.create({
      data: {
        memberId: member.id,
        planId: plan.id,
        startDate: joinedAt,
        endDate,
        status: membershipStatus,
        pricePaise: plan.pricePaise,
        joiningFeePaise,
        discountPaise,
        discountReason: discountPaise > 0
          ? pick([
              'Festive offer',
              'Referral discount',
              'Corporate tie-up',
              'Student concession',
              'Renewal loyalty discount',
            ])
          : null,
        totalPaise,
        ...(membershipStatus === 'FROZEN'
          ? {
              freezeStartDate: addDays(now, -randomInt(3, 20)),
              freezeReason: pick([
                'Travelling out of station',
                'Medical leave',
                'Work commitments',
                'Family function',
              ]),
            }
          : {}),
      },
    });

    await prisma.membershipEvent.create({
      data: {
        membershipId: membership.id,
        type: 'CREATED',
        details: { planName: plan.name, totalPaise },
        performedById: receptionist.id,
      },
    });

    createdMembers.push({
      id: member.id,
      memberId: member.memberId,
      membershipId: membership.id,
      startDate: joinedAt,
      endDate,
      status,
    });

    // ── Payments ─────────────────────────────────────────────────────────
    /**
     * Payment behaviour mirrors a real gym:
     *   ~72% paid in full up front
     *   ~20% partial (still owing)
     *   ~8%  nothing paid — the defaulters the owner needs to chase
     */
    const paymentRoll = random();
    let amountPaid: number;

    if (paymentRoll < 0.72) {
      amountPaid = totalPaise;
    } else if (paymentRoll < 0.92) {
      // Partial: a round-ish figure, as cash payments tend to be.
      amountPaid = Math.round((totalPaise * randomInt(30, 75)) / 100 / 10000) * 10000;
    } else {
      amountPaid = 0;
    }

    if (amountPaid > 0) {
      const mode = pick(['CASH', 'UPI', 'UPI', 'UPI', 'CARD', 'NET_BANKING'] as const);

      await prisma.payment.create({
        data: {
          memberId: member.id,
          membershipId: membership.id,
          amountPaise: amountPaid,
          discountPaise,
          discountReason: discountPaise > 0 ? 'Applied at registration' : null,
          mode,
          status: 'PAID',
          reference: mode === 'CASH' ? null : generateReference(mode),
          paidAt: joinedAt,
          collectedById: chance(0.7) ? receptionist.id : manager.id,
        },
      });

      // Some partial payers came back and paid a second instalment.
      if (amountPaid < totalPaise && chance(0.35)) {
        const secondAmount = Math.round(
          ((totalPaise - amountPaid) * randomInt(40, 90)) / 100 / 10000,
        ) * 10000;

        if (secondAmount > 0) {
          const secondMode = pick(['CASH', 'UPI', 'CARD'] as const);
          await prisma.payment.create({
            data: {
              memberId: member.id,
              membershipId: membership.id,
              amountPaise: secondAmount,
              mode: secondMode,
              status: 'PAID',
              reference: secondMode === 'CASH' ? null : generateReference(secondMode),
              paidAt: addDays(joinedAt, randomInt(5, 45)),
              notes: 'Balance instalment',
              collectedById: receptionist.id,
            },
          });
        }
      }
    }

    if ((i + 1) % 50 === 0) {
      console.log(`    ... ${i + 1}/${MEMBER_COUNT}`);
    }
  }

  console.log(`    ✓ ${MEMBER_COUNT} members with memberships and payments`);

  // ── Attendance ─────────────────────────────────────────────────────────
  console.log('  Generating attendance history...');

  let attendanceCount = 0;
  const attendanceRows: Array<{
    memberId: string;
    checkInAt: Date;
    checkOutAt: Date | null;
    method: string;
    markedById: string | null;
  }> = [];

  for (const member of createdMembers) {
    if (member.status === 'CANCELLED') continue;

    // How diligently this member actually attends.
    const commitment = random();
    const visitsPerWeek =
      commitment > 0.75 ? randomInt(4, 6)
      : commitment > 0.45 ? randomInt(2, 4)
      : randomInt(0, 2);

    if (visitsPerWeek === 0) continue;

    const historyStart = member.startDate;
    const historyEnd = member.endDate < now ? member.endDate : now;
    const totalDays = Math.max(
      0,
      Math.floor((historyEnd.getTime() - historyStart.getTime()) / 86_400_000),
    );

    // Cap history so the seed does not generate 100k rows for year members.
    const daysToGenerate = Math.min(totalDays, 120);
    const startOffset = totalDays - daysToGenerate;

    for (let day = 0; day < daysToGenerate; day++) {
      const date = addDays(historyStart, startOffset + day);

      // Sunday is quiet at most Hyderabad gyms.
      const isSunday = date.getDay() === 0;
      const attendProbability = (visitsPerWeek / 7) * (isSunday ? 0.3 : 1);

      if (!chance(attendProbability)) continue;

      /**
       * Check-in times cluster into the morning (6–9am) and evening (5–9pm)
       * peaks that any gym sees. A flat distribution would make the
       * peak-hours heatmap meaningless.
       */
      const isMorning = chance(0.42);
      const hour = isMorning ? randomInt(6, 9) : randomInt(17, 21);
      const checkInAt = new Date(date);
      checkInAt.setHours(hour, randomInt(0, 59), randomInt(0, 59), 0);

      // Most members check out; some forget, leaving a null.
      const checkOutAt = chance(0.85)
        ? new Date(checkInAt.getTime() + randomInt(35, 110) * 60_000)
        : null;

      attendanceRows.push({
        memberId: member.id,
        checkInAt,
        checkOutAt,
        method: chance(0.88) ? 'QR' : 'MANUAL',
        markedById: chance(0.88) ? null : receptionist.id,
      });
      attendanceCount++;
    }
  }

  // Batched: 20k individual inserts over a pooled connection would take
  // minutes and risk a timeout.
  const BATCH_SIZE = 1000;
  for (let i = 0; i < attendanceRows.length; i += BATCH_SIZE) {
    await prisma.attendance.createMany({
      data: attendanceRows.slice(i, i + BATCH_SIZE),
    });
  }

  console.log(`    ✓ ${attendanceCount} attendance records`);

  // ── Sequences ──────────────────────────────────────────────────────────
  // Set to the highest ID issued, so the next real registration continues
  // the series rather than colliding with a seeded member.
  const byYear = new Map<number, number>();
  for (const member of createdMembers) {
    const [, yearStr, seqStr] = member.memberId.split('-');
    const year = Number(yearStr);
    const seq = Number(seqStr);
    byYear.set(year, Math.max(byYear.get(year) ?? 0, seq));
  }

  for (const [year, lastSequence] of byYear) {
    await prisma.memberSequence.create({ data: { year, lastSequence } });
  }

  // ── Settings ───────────────────────────────────────────────────────────
  await prisma.setting.createMany({
    data: [
      {
        key: 'gym.name',
        value: 'A to Z Fitness',
        label: 'Gym name',
        group: 'general',
      },
      {
        key: 'gym.address',
        value: 'Mehdipatnam, Hyderabad, Telangana 500028',
        label: 'Address',
        group: 'general',
      },
      {
        key: 'tax.gstRegistered',
        value: false,
        label: 'GST registered',
        group: 'tax',
      },
      {
        key: 'reminders.expiryDaysBefore',
        value: [7, 3, 1],
        label: 'Send expiry reminders this many days before',
        group: 'reminders',
      },
      {
        key: 'reminders.winbackAfterDays',
        value: 21,
        label: 'Win-back SMS after this many days absent',
        group: 'reminders',
      },
    ],
  });

  // ── Summary ────────────────────────────────────────────────────────────
  const [stats, revenue, dues] = await Promise.all([
    prisma.member.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.payment.aggregate({ _sum: { amountPaise: true } }),
    prisma.membership.aggregate({ _sum: { totalPaise: true } }),
  ]);

  const collected = revenue._sum.amountPaise ?? 0;
  const billed = dues._sum.totalPaise ?? 0;

  console.log('\n  ┌─ Seed summary ──────────────────────────────');
  for (const row of stats) {
    console.log(`  │ ${row.status.padEnd(10)} ${String(row._count._all).padStart(4)}`);
  }
  console.log('  ├─────────────────────────────────────────────');
  console.log(`  │ Billed     ₹${(billed / 100).toLocaleString('en-IN')}`);
  console.log(`  │ Collected  ₹${(collected / 100).toLocaleString('en-IN')}`);
  console.log(`  │ Pending    ₹${((billed - collected) / 100).toLocaleString('en-IN')}`);
  console.log('  └─────────────────────────────────────────────\n');

  console.log('  Sign in with any of these (password: Password123):');
  console.log(`    Owner        ${owner.email}`);
  console.log(`    Manager      ${manager.email}`);
  console.log(`    Receptionist ${receptionist.email}`);
  console.log(`    Trainer      ${trainerSeeds[0]?.email}\n`);
  console.log('✅ Seed complete\n');
}

/** Plausible transaction references, so the payments list looks real. */
function generateReference(mode: string): string {
  switch (mode) {
    case 'UPI':
      return `${randomInt(100000000000, 999999999999)}`;
    case 'CARD':
      return `AUTH${randomInt(100000, 999999)}`;
    case 'NET_BANKING':
      return `NB${randomInt(10000000, 99999999)}`;
    default:
      return `REF${randomInt(100000, 999999)}`;
  }
}

main()
  .catch((error: unknown) => {
    console.error('\n❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
