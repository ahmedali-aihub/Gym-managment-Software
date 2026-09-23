/**
 * Demo dataset for UI review without a database.
 *
 * Generated deterministically so the screen looks the same on every reload —
 * evaluating a layout against data that reshuffles each refresh is miserable.
 *
 * The distributions deliberately mirror a real gym rather than a flattering
 * one: expired members, partial payments, defaulters and quiet Sundays. A
 * demo where everyone is active and fully paid makes the dashboard look
 * wonderful and tells you nothing about whether it works.
 */

const MALE_NAMES = [
  'Aarav', 'Abdul', 'Adnan', 'Ajay', 'Akash', 'Ali', 'Anand', 'Arjun',
  'Asif', 'Balaji', 'Chaitanya', 'Deepak', 'Faisal', 'Ganesh', 'Harish',
  'Imran', 'Javed', 'Karthik', 'Kiran', 'Krishna', 'Mahesh', 'Manoj',
  'Mohammed', 'Naveen', 'Nikhil', 'Pavan', 'Praveen', 'Rahul', 'Rajesh',
  'Rakesh', 'Ramesh', 'Ravi', 'Rohit', 'Sagar', 'Salman', 'Sandeep',
  'Srikanth', 'Sunil', 'Suresh', 'Tarun', 'Varun', 'Venkatesh', 'Vijay',
  'Vikram', 'Vishal', 'Yaseen', 'Zubair',
];

const FEMALE_NAMES = [
  'Aaliya', 'Aditi', 'Afreen', 'Aisha', 'Anitha', 'Anjali', 'Anusha',
  'Asma', 'Bhavani', 'Deepika', 'Divya', 'Fatima', 'Gayathri', 'Harini',
  'Jyothi', 'Kavitha', 'Keerthi', 'Lakshmi', 'Madhuri', 'Meena', 'Nandini',
  'Navya', 'Neha', 'Pooja', 'Priya', 'Ramya', 'Rashmi', 'Rubina', 'Sadia',
  'Sandhya', 'Sanjana', 'Shabana', 'Shalini', 'Shilpa', 'Sneha', 'Sunitha',
  'Swathi', 'Tabassum', 'Vandana', 'Vidya', 'Zainab',
];

const SURNAMES = [
  'Reddy', 'Rao', 'Naidu', 'Sharma', 'Kumar', 'Chowdary', 'Goud', 'Yadav',
  'Shetty', 'Nair', 'Iyer', 'Patel', 'Mehta', 'Joshi', 'Kulkarni', 'Patil',
  'Khan', 'Ahmed', 'Syed', 'Hussain', 'Siddiqui', 'Ansari', 'Qureshi',
  'Sheikh', 'Pathan', 'Mirza', 'Baig', 'Prasad', 'Murthy', 'Singh',
];

const PLANS = [
  { id: 'plan-1', name: 'Monthly', durationDays: 30, pricePaise: 150_000 },
  { id: 'plan-2', name: 'Quarterly', durationDays: 90, pricePaise: 400_000 },
  { id: 'plan-3', name: 'Half-Yearly', durationDays: 180, pricePaise: 700_000 },
  { id: 'plan-4', name: 'Yearly', durationDays: 365, pricePaise: 1_200_000 },
  { id: 'plan-5', name: 'Student Monthly', durationDays: 30, pricePaise: 100_000 },
  { id: 'plan-6', name: 'Couple Quarterly', durationDays: 90, pricePaise: 700_000 },
];

/** Deterministic PRNG — same data every reload. */
let seed = 20260919;
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}
function pick<T>(items: T[]): T {
  return items[Math.floor(random() * items.length)]!;
}
/** Distinct items, so a member never lists the same goal twice. */
function pickMany<T>(items: T[], count: number): T[] {
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

export type DemoStatus = 'ACTIVE' | 'EXPIRED' | 'FROZEN' | 'CANCELLED';

export type DemoGoal =
  | 'WEIGHT_LOSS'
  | 'MUSCLE_GAIN'
  | 'GENERAL_FITNESS'
  | 'STRENGTH'
  | 'ENDURANCE'
  | 'FLEXIBILITY'
  | 'SPORTS_TRAINING'
  | 'REHABILITATION';

const GOALS: DemoGoal[] = [
  'WEIGHT_LOSS',
  'MUSCLE_GAIN',
  'GENERAL_FITNESS',
  'STRENGTH',
  'ENDURANCE',
  'FLEXIBILITY',
  'SPORTS_TRAINING',
  'REHABILITATION',
];

export interface DemoMember {
  id: string;
  memberId: string;
  fullName: string;
  phone: string;
  email: string | null;
  photoUrl: string | null;
  status: DemoStatus;
  joinedAt: string;
  goals: DemoGoal[];
  balanceDuePaise: number;
  totalPaidPaise: number;
  totalBilledPaise: number;
  memberships: Array<{
    id: string;
    startDate: string;
    endDate: string;
    plan: { name: string };
  }>;
}

function buildMembers(count: number): DemoMember[] {
  seed = 20260919;
  const now = new Date();
  const members: DemoMember[] = [];
  const usedPhones = new Set<string>();

  for (let i = 0; i < count; i++) {
    const isMale = chance(0.62);
    const firstName = isMale ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
    const fullName = `${firstName} ${pick(SURNAMES)}`;
    const plan = pick(PLANS);

    // Weighted toward recent joins — a growing gym has more of them.
    const daysAgo = Math.floor(Math.pow(random(), 1.6) * 420);
    const joinedAt = addDays(now, -daysAgo);
    const endDate = addDays(joinedAt, plan.durationDays - 1);

    // Status follows the dates rather than being assigned at random, so no
    // "active" member shows an expiry date from last year.
    let status: DemoStatus;
    if (endDate < now) {
      status = chance(0.08) ? 'CANCELLED' : 'EXPIRED';
    } else if (chance(0.05)) {
      status = 'FROZEN';
    } else {
      status = 'ACTIVE';
    }

    let phone: string;
    do {
      phone = `${pick(['6', '7', '8', '9'])}${String(randomInt(100000000, 999999999)).padStart(9, '0')}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);

    // ~72% paid in full, ~20% partial, ~8% owe everything.
    const total = plan.pricePaise;
    const roll = random();
    const balanceDuePaise =
      roll < 0.72
        ? 0
        : roll < 0.92
          ? Math.round((total * randomInt(25, 70)) / 100 / 10000) * 10000
          : total;

    members.push({
      id: `demo-member-${i + 1}`,
      memberId: `AZF-${joinedAt.getFullYear()}-${String(i + 1).padStart(4, '0')}`,
      fullName,
      phone,
      email: chance(0.55)
        ? `${firstName.toLowerCase()}.${randomInt(10, 999)}@gmail.com`
        : null,
      photoUrl: null,
      status,
      joinedAt: joinedAt.toISOString(),
      // Weighted so weight loss and general fitness dominate, as they do in
      // any neighbourhood gym — a flat distribution would make the focus
      // filter look artificial.
      goals: pickMany(
        chance(0.55)
          ? (['WEIGHT_LOSS', 'GENERAL_FITNESS', 'MUSCLE_GAIN'] as DemoGoal[])
          : GOALS,
        randomInt(1, 3),
      ),
      balanceDuePaise,
      totalPaidPaise: total - balanceDuePaise,
      totalBilledPaise: total,
      memberships: [
        {
          id: `demo-membership-${i + 1}`,
          startDate: joinedAt.toISOString(),
          endDate: endDate.toISOString(),
          plan: { name: plan.name },
        },
      ],
    });
  }

  return members;
}

export const DEMO_MEMBERS = buildMembers(200);

export const DEMO_USER = {
  id: 'demo-owner',
  fullName: 'Mohammed Azharuddin',
  email: 'owner@atozfitness.in',
  phone: '9876500001',
  role: 'OWNER' as const,
  isActive: true,
  avatarUrl: null,
  lastLoginAt: new Date().toISOString(),
};

export function buildMemberStats() {
  const counts = { ACTIVE: 0, EXPIRED: 0, FROZEN: 0, CANCELLED: 0 };
  const now = new Date();
  const weekAhead = addDays(now, 7);
  let expiringSoon = 0;
  let totalDuesPaise = 0;

  for (const member of DEMO_MEMBERS) {
    counts[member.status]++;
    totalDuesPaise += member.balanceDuePaise;

    const end = new Date(member.memberships[0]!.endDate);
    if (member.status === 'ACTIVE' && end >= now && end <= weekAhead) {
      expiringSoon++;
    }
  }

  return {
    total: DEMO_MEMBERS.length,
    active: counts.ACTIVE,
    expiringSoon,
    expired: counts.EXPIRED,
    frozen: counts.FROZEN,
    cancelled: counts.CANCELLED,
    totalDuesPaise,
  };
}

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function buildDashboard() {
  const stats = buildMemberStats();
  const now = new Date();

  // Revenue trending upward with month-to-month variation, so the chart has
  // a readable shape rather than a straight line.
  const revenueTrend = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const base = 180_000 + i * 22_000;
    const variance = Math.sin(i * 1.3) * 45_000;
    return {
      month: MONTH_LABELS[date.getMonth()]!,
      collectedPaise: Math.round(base + variance) * 100,
      pendingPaise: 0,
    };
  });

  const memberGrowth = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return {
      month: MONTH_LABELS[date.getMonth()]!,
      // Expiries deliberately outpace joins in a couple of months. The
      // previous generator produced twelve positive months out of twelve,
      // which made the net-change chart structurally incapable of showing
      // the shrinkage it exists to surface.
      joined: 7 + Math.round(Math.sin(i * 0.9) * 5) + Math.round(i * 0.5),
      expired: 8 + Math.round(Math.cos(i * 1.4) * 5),
    };
  });

  const planCounts = new Map<string, number>();
  for (const member of DEMO_MEMBERS) {
    if (member.status !== 'ACTIVE') continue;
    const name = member.memberships[0]!.plan.name;
    planCounts.set(name, (planCounts.get(name) ?? 0) + 1);
  }

  const planDistribution = [...planCounts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const paymentModes = [
    { name: 'UPI', value: 8_45_000 * 100 },
    { name: 'Cash', value: 4_20_000 * 100 },
    { name: 'Card', value: 2_15_000 * 100 },
    { name: 'Net Banking', value: 85_000 * 100 },
  ];

  // Morning (6–9) and evening (17–21) peaks, with Sunday quiet — the shape
  // any neighbourhood gym actually sees.
  const peakHours: Array<{ day: number; hour: number; count: number }> = [];
  seed = 777;
  for (let day = 0; day < 7; day++) {
    for (let hour = 6; hour <= 22; hour++) {
      const isMorningPeak = hour >= 6 && hour <= 9;
      const isEveningPeak = hour >= 17 && hour <= 21;
      const dayFactor = day === 6 ? 0.35 : day === 5 ? 0.75 : 1;

      let count = 0;
      if (isEveningPeak) count = Math.round(randomInt(18, 34) * dayFactor);
      else if (isMorningPeak) count = Math.round(randomInt(12, 24) * dayFactor);
      else count = Math.round(randomInt(0, 6) * dayFactor);

      peakHours.push({ day, hour, count });
    }
  }

  const recentCheckIns = DEMO_MEMBERS.filter((m) => m.status === 'ACTIVE')
    .slice(0, 8)
    .map((member, index) => ({
      id: `demo-checkin-${index}`,
      checkInAt: new Date(now.getTime() - (index * 7 + 2) * 60_000).toISOString(),
      member: {
        id: member.id,
        memberId: member.memberId,
        fullName: member.fullName,
        photoUrl: null,
      },
    }));

  const weekAhead = addDays(now, 7);
  const expiring = DEMO_MEMBERS.filter((member) => {
    if (member.status !== 'ACTIVE') return false;
    const end = new Date(member.memberships[0]!.endDate);
    return end >= now && end <= weekAhead;
  })
    .slice(0, 6)
    .map((member) => ({
      id: `demo-expiring-${member.id}`,
      endDate: member.memberships[0]!.endDate,
      member: {
        id: member.id,
        memberId: member.memberId,
        fullName: member.fullName,
        phone: member.phone,
        photoUrl: null,
      },
      plan: { name: member.memberships[0]!.plan.name },
    }));

  const defaulters = [...DEMO_MEMBERS]
    .filter((m) => m.balanceDuePaise > 0)
    .sort((a, b) => b.balanceDuePaise - a.balanceDuePaise)
    .slice(0, 5)
    .map((member) => ({
      id: member.id,
      memberId: member.memberId,
      fullName: member.fullName,
      phone: member.phone,
      photoUrl: null,
      balanceDuePaise: member.balanceDuePaise,
    }));

  const thisMonthPaise = revenueTrend[11]?.collectedPaise ?? 0;
  const lastMonthPaise = revenueTrend[10]?.collectedPaise ?? 0;

  return {
    overview: {
      members: {
        total: stats.total,
        active: stats.active,
        expired: stats.expired,
        frozen: stats.frozen,
        expiringSoon: stats.expiringSoon,
      },
      joins: {
        thisMonth: memberGrowth[11]?.joined ?? 0,
        lastMonth: memberGrowth[10]?.joined ?? 0,
      },
      revenue: {
        thisMonthPaise,
        lastMonthPaise,
        collectedPaise: revenueTrend.reduce((s, r) => s + r.collectedPaise, 0),
        pendingPaise: stats.totalDuesPaise,
      },
      retention: { churnRatePercent: 6.4, retentionRatePercent: 93.6 },
    },
    revenueTrend,
    memberGrowth,
    planDistribution,
    paymentModes,
    peakHours,
    recentCheckIns,
    expiring,
    defaulters,
  };
}
