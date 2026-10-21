/**
 * Turn the FitGymSoftware export (backups/fitgym/) into rows for our schema.
 *
 * PURE. Nothing here touches the database or the network: it reads the
 * export and returns plain objects, so the preview and the import run the
 * exact same mapping and a dry run is a true picture of what would be written.
 *
 * Sources and why each is needed:
 *   members.json        every member (id, name, phone, address, photo, DOB…)
 *   profiles.jsonl      per-member extras only the profile has: emergency
 *                       contact and medical history
 *   memberships.json    every plan period ever sold, with amounts
 *   invoices.json       every payment, with the old receipt number
 *   freezes.json        freeze periods (all historical)
 *   master-memberships  the old plan catalogue
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKUPS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../backups');
const FITGYM = path.join(BACKUPS, 'fitgym');

/** Same placeholder the spreadsheet importer uses: never a real birthday. */
export const PLACEHOLDER_DOB = new Date(1900, 0, 1);
export const IMPORT_TAG = '[Imported from FitGymSoftware]';

// ─── Old-system shapes (only the fields we read) ────────────────────────────

interface OldMember {
  id: number; localId: string; memberName: string; gender: 'M' | 'F' | null;
  dob: string | null; anniversary: string | null; contact: string | null;
  address: string | null; profilePhotoPath: string | null; datetimeCreated: string;
  remark: string | null; emailId: string | null; bloodGroup: string | null;
  groupName: string | null;
}
interface OldProfile { emergencyContact: string | null; medicalHistory: string | null }
interface OldMembership {
  id: number; memberId: number; masterMembershipId: number; membershipName: string;
  startDate: string; endDate: string; actualAmount: number; discountedAmount: number;
  paidAmount: number; balanceAmount: number; balancePaymentDate: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'CANCELLED'; trainerName: string | null;
}
interface OldInvoice {
  id: number; paymentLocalId: string; memberId: number; txnDatetime: string;
  membershipName: string; startDate: string; endDate: string; amount: number;
  paymentModeName: string; remark: string | null;
}
interface OldFreeze {
  memberId: number; masterMembershipId: number; startDate: string;
  freezeFromDate: string; freezeToDate: string; remark: string | null;
}
interface OldPlan { id: number; membership: string; maxCost: number; months: number; days: number }

// ─── Our-side rows ──────────────────────────────────────────────────────────

export type PlanType = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY' | 'CUSTOM';

export interface PlanRow {
  oldId: number; name: string; type: PlanType; durationDays: number; pricePaise: number;
  isActive: boolean; sortOrder: number;
  /** Where the price came from: the old catalogue, or what members paid. */
  priceSource: 'catalogue' | 'most common sale';
  timesSold: number; firstSold: string | null; lastSold: string | null;
}

export interface PaymentRow {
  oldId: number; receiptNumber: string; amountPaise: number;
  mode: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING' | 'ONLINE';
  paidAt: Date; notes: string;
  /** Snapshot of the old record's mode name, e.g. "Google Pay". */
  oldMode: string;
}

export interface MembershipRow {
  oldId: number; planOldId: number; planName: string;
  startDate: Date; endDate: Date;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  pricePaise: number; discountPaise: number; totalPaise: number;
  freezeStartDate: Date | null; freezeEndDate: Date | null;
  freezeDaysUsed: number; freezeReason: string | null;
  payments: PaymentRow[];
  /** Old system's stored balance, for comparison only. */
  oldBalancePaise: number;
  /** totalPaise minus the payments we import. What our dues screens will show. */
  duePaise: number;
}

export interface MemberRow {
  oldId: number; memberId: string; fullName: string; phone: string;
  email: string | null; dateOfBirth: Date; gender: 'MALE' | 'FEMALE' | 'OTHER';
  photoSourceUrl: string | null; addressLine1: string | null;
  emergencyContactPhone: string | null; medicalNotes: string | null; notes: string;
  status: 'ACTIVE' | 'EXPIRED' | 'FROZEN' | 'CANCELLED';
  joinedAt: Date; memberships: MembershipRow[];
  warnings: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const readJson = <T>(name: string): T =>
  (JSON.parse(readFileSync(path.join(FITGYM, `${name}.json`), 'utf8')) as { data: T }).data;

function readJsonl<T>(name: string): Map<string, T> {
  const file = path.join(FITGYM, `${name}.jsonl`);
  const out = new Map<string, T>();
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as { key: string; data: T };
      out.set(rec.key, rec.data);
    } catch {
      // Torn final line from an interrupted export; that member is re-fetched.
    }
  }
  return out;
}

const rupeesToPaise = (rupees: number | null | undefined) => Math.round((rupees ?? 0) * 100);

/**
 * The old system stores calendar dates as "YYYY-MM-DD" (or that day at UTC
 * midnight). Our app stores a start as IST midnight and an end as the last
 * millisecond of that IST day, so a membership ending "17 Nov" stays valid
 * all of 17 Nov at the front desk.
 */
const istStartOfDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00.000+05:30`);
const istEndOfDay = (d: string) => new Date(`${d.slice(0, 10)}T23:59:59.999+05:30`);

const PAYMENT_MODES: Record<string, PaymentRow['mode']> = {
  cash: 'CASH',
  card: 'CARD',
  'bank transfer': 'NET_BANKING',
  upi: 'UPI',
  'google pay': 'UPI',
  phonepe: 'UPI',
  paytm: 'UPI',
  'amazon pay': 'UPI',
};

function planType(months: number, days: number): PlanType {
  if (days === 0 && months === 1) return 'MONTHLY';
  if (days === 0 && months === 3) return 'QUARTERLY';
  if (days === 0 && months === 6) return 'HALF_YEARLY';
  if (days === 0 && months === 12) return 'YEARLY';
  return 'CUSTOM';
}

/** 12 months is a year, not 360 days; other month counts use 30 days each. */
function durationDays(months: number, days: number): number {
  const years = Math.floor(months / 12);
  return years * 365 + (months % 12) * 30 + days;
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function cleanPhone(raw: string | null): { phone: string; warning: string | null } {
  if (!raw?.trim()) return { phone: '', warning: 'no phone number in old system' };
  const digits = raw.replace(/\D/g, '');
  let phone = digits;
  if (digits.length === 12 && digits.startsWith('91')) phone = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) phone = digits.slice(1);
  if (/^[6-9]\d{9}$/.test(phone)) return { phone, warning: null };
  // Kept as typed rather than dropped: a 9-digit number is usually one typo
  // away from right, and the front desk can fix it with the member present.
  return { phone: raw.trim(), warning: `phone "${raw.trim()}" is not a valid 10-digit mobile` };
}

const tidyName = (name: string) => name.replace(/\s+/g, ' ').trim();

// ─── Transform ──────────────────────────────────────────────────────────────

export interface Legacy {
  plans: PlanRow[];
  members: MemberRow[];
  stats: Record<string, number>;
}

/**
 * Old plans the gym still sells: created natively in FitGymSoftware with
 * real prices. The rest came from an earlier 2019 data migration with a ₹1
 * placeholder price and are kept only so history points at a real plan.
 */
const isPlaceholderPrice = (p: OldPlan) => p.maxCost <= 1;

export function loadLegacy(): Legacy {
  const oldPlans = readJson<OldPlan[]>('master-memberships');
  const oldMembers = readJson<{ rows: OldMember[] }>('members').rows;
  const oldMemberships = readJson<{ rows: OldMembership[] }>('memberships').rows;
  const oldInvoices = readJson<{ rows: OldInvoice[] }>('invoices').rows;
  const oldFreezes = readJson<{ rows: OldFreeze[] }>('freezes').rows;
  const profiles = readJsonl<OldProfile>('profiles');

  // Plans
  const soldByPlan = new Map<number, OldMembership[]>();
  for (const m of oldMemberships) {
    const list = soldByPlan.get(m.masterMembershipId) ?? [];
    list.push(m);
    soldByPlan.set(m.masterMembershipId, list);
  }
  const plans: PlanRow[] = oldPlans
    .map((p) => {
      const sold = soldByPlan.get(p.id) ?? [];
      const starts = sold.map((s) => s.startDate.slice(0, 10)).sort();
      const placeholder = isPlaceholderPrice(p);
      return {
        oldId: p.id,
        name: p.membership.trim(),
        type: planType(p.months, p.days),
        durationDays: durationDays(p.months, p.days),
        pricePaise: placeholder
          ? rupeesToPaise(mostCommon(sold.map((s) => s.actualAmount).filter((a) => a > 1)) ?? 0)
          : rupeesToPaise(p.maxCost),
        isActive: !placeholder,
        sortOrder: 0,
        priceSource: placeholder ? ('most common sale' as const) : ('catalogue' as const),
        timesSold: sold.length,
        firstSold: starts[0] ?? null,
        lastSold: starts.at(-1) ?? null,
      };
    })
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.durationDays - b.durationDays || a.name.localeCompare(b.name))
    .map((p, i) => ({ ...p, sortOrder: i + 1 }));
  const planById = new Map(plans.map((p) => [p.oldId, p]));

  // Payments → memberships. The invoice carries no membership id, only the
  // member, plan name and period; that triple is unique except for ten
  // duplicate memberships, which the end date and paid amount then separate.
  const membershipsByMember = new Map<number, OldMembership[]>();
  for (const m of oldMemberships) {
    const list = membershipsByMember.get(m.memberId) ?? [];
    list.push(m);
    membershipsByMember.set(m.memberId, list);
  }
  const paymentsByMembership = new Map<number, OldInvoice[]>();
  const allocated = new Map<number, number>();
  let unmatchedPayments = 0;
  for (const inv of [...oldInvoices].sort((a, b) => a.txnDatetime.localeCompare(b.txnDatetime))) {
    const candidates = (membershipsByMember.get(inv.memberId) ?? []).filter(
      (m) => m.membershipName === inv.membershipName && m.startDate.slice(0, 10) === inv.startDate?.slice(0, 10),
    );
    const sameEnd = candidates.filter((m) => m.endDate.slice(0, 10) === inv.endDate?.slice(0, 10));
    const pool = sameEnd.length ? sameEnd : candidates;
    // Prefer the candidate whose recorded paid amount still has room.
    const target =
      pool.find((m) => (allocated.get(m.id) ?? 0) + inv.amount <= m.paidAmount) ?? pool[0];
    if (!target) {
      unmatchedPayments++;
      continue;
    }
    allocated.set(target.id, (allocated.get(target.id) ?? 0) + inv.amount);
    const list = paymentsByMembership.get(target.id) ?? [];
    list.push(inv);
    paymentsByMembership.set(target.id, list);
  }

  const freezeFor = (m: OldMembership) =>
    oldFreezes.find(
      (f) => f.memberId === m.memberId && f.masterMembershipId === m.masterMembershipId &&
        f.startDate.slice(0, 10) === m.startDate.slice(0, 10),
    );

  const toMembership = (m: OldMembership): MembershipRow => {
    const plan = planById.get(m.masterMembershipId)!;
    // A "discounted" amount above the list price is a manual price override,
    // not a negative discount.
    const pricePaise = rupeesToPaise(Math.max(m.actualAmount, m.discountedAmount));
    const totalPaise = rupeesToPaise(m.discountedAmount);
    const freeze = freezeFor(m);
    const payments = (paymentsByMembership.get(m.id) ?? []).map((inv): PaymentRow => {
      const oldMode = inv.paymentModeName;
      return {
        oldId: inv.id,
        receiptNumber: inv.paymentLocalId,
        amountPaise: rupeesToPaise(inv.amount),
        mode: PAYMENT_MODES[oldMode.trim().toLowerCase()] ?? 'ONLINE',
        paidAt: new Date(inv.txnDatetime),
        oldMode,
        notes: [`Old receipt #${inv.paymentLocalId}`, oldMode, inv.remark?.trim()].filter(Boolean).join(' · '),
      };
    });
    const paidPaise = payments.reduce((sum, p) => sum + p.amountPaise, 0);
    return {
      oldId: m.id,
      planOldId: plan.oldId,
      planName: plan.name,
      startDate: istStartOfDay(m.startDate),
      endDate: istEndOfDay(m.endDate),
      status: m.status === 'ACTIVE' ? 'ACTIVE' : m.status === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED',
      pricePaise,
      discountPaise: pricePaise - totalPaise,
      totalPaise,
      freezeStartDate: freeze ? istStartOfDay(freeze.freezeFromDate) : null,
      freezeEndDate: freeze ? istEndOfDay(freeze.freezeToDate) : null,
      freezeDaysUsed: freeze
        ? Math.round((istEndOfDay(freeze.freezeToDate).getTime() - istStartOfDay(freeze.freezeFromDate).getTime()) / 86_400_000)
        : 0,
      freezeReason: freeze?.remark?.trim() || null,
      payments,
      oldBalancePaise: rupeesToPaise(m.balanceAmount),
      duePaise: Math.max(0, totalPaise - paidPaise),
    };
  };

  const members: MemberRow[] = oldMembers.map((om) => {
    const warnings: string[] = [];
    const profile = profiles.get(String(om.id));
    if (!profile) warnings.push('profile not exported yet');
    const { phone, warning } = cleanPhone(om.contact);
    if (warning) warnings.push(warning);

    const memberships = (membershipsByMember.get(om.id) ?? [])
      .map(toMembership)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const latest = memberships.at(-1);
    const status: MemberRow['status'] = memberships.some((m) => m.status === 'ACTIVE')
      ? 'ACTIVE'
      : latest?.status === 'CANCELLED'
        ? 'CANCELLED'
        : 'EXPIRED';

    // The old record's creation date is when it was typed in, which for the
    // 2019 data is later than the member's first membership.
    const created = new Date(om.datetimeCreated);
    const firstStart = memberships[0]?.startDate;
    const joinedAt = firstStart && firstStart < created ? firstStart : created;

    const extras: string[] = [];
    if (om.groupName) extras.push(`Batch: ${om.groupName}.`);
    if (om.anniversary) extras.push(`Anniversary: ${om.anniversary.slice(0, 10)}.`);
    if (om.remark?.trim()) extras.push(om.remark.trim());
    if (!om.dob) extras.push('Missing date of birth — please confirm on next visit.');
    if (!phone || warning) extras.push('Phone number needs checking.');

    return {
      oldId: om.id,
      memberId: om.localId,
      fullName: tidyName(om.memberName),
      phone,
      email: om.emailId?.trim() || null,
      dateOfBirth: om.dob ? istStartOfDay(om.dob) : PLACEHOLDER_DOB,
      gender: om.gender === 'M' ? 'MALE' : om.gender === 'F' ? 'FEMALE' : 'OTHER',
      photoSourceUrl: om.profilePhotoPath,
      addressLine1: om.address?.trim() || null,
      emergencyContactPhone: profile?.emergencyContact?.trim() || null,
      medicalNotes: profile?.medicalHistory?.trim() || null,
      notes: [IMPORT_TAG, ...extras].join(' '),
      status,
      joinedAt,
      memberships,
      warnings,
    };
  });

  const allMemberships = members.flatMap((m) => m.memberships);
  const stats = {
    members: members.length,
    memberships: allMemberships.length,
    payments: allMemberships.reduce((n, m) => n + m.payments.length, 0),
    paymentsInExport: oldInvoices.length,
    unmatchedPayments,
    profilesExported: profiles.size,
    photos: members.filter((m) => m.photoSourceUrl).length,
    activeMembers: members.filter((m) => m.status === 'ACTIVE').length,
    duePaise: allMemberships.reduce((n, m) => n + m.duePaise, 0),
    oldBalancePaise: allMemberships.reduce((n, m) => n + m.oldBalancePaise, 0),
    membersWithWarnings: members.filter((m) => m.warnings.some((w) => w !== 'profile not exported yet')).length,
  };

  return { plans, members, stats };
}
