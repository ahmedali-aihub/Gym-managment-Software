import { z } from 'zod';
import { MembershipStatus, PlanType } from '../types/enums.js';
import {
  cuidSchema,
  paginationSchema,
  paiseSchema,
  queryBooleanSchema,
} from './common.schema.js';

export const createPlanSchema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(100),
    description: z.string().trim().max(500).optional(),
    type: z.nativeEnum(PlanType),
    /** Duration in days. Drives expiry calculation. */
    durationDays: z
      .number()
      .int('Duration must be whole days')
      .min(1, 'Duration must be at least 1 day')
      .max(3650, 'Duration cannot exceed 10 years'),
    pricePaise: paiseSchema,
    /** One-time admission fee charged on first join. */
    joiningFeePaise: paiseSchema.default(0),
    /** Free days a member may freeze during this plan. 0 disables freezing. */
    maxFreezeDays: z.number().int().min(0).max(365).default(0),
    features: z.array(z.string().trim().max(120)).max(20).default([]),
    isActive: z.boolean().default(true),
    /** Display order in the plan picker. */
    sortOrder: z.number().int().min(0).default(0),
  })
  .refine((p) => p.type !== PlanType.CUSTOM || p.durationDays > 0, {
    message: 'Custom plans need an explicit duration',
    path: ['durationDays'],
  });

export type CreatePlanInput = z.input<typeof createPlanSchema>;

export const updatePlanSchema = createPlanSchema.innerType().partial();
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const planQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  type: z.nativeEnum(PlanType).optional(),
  isActive: queryBooleanSchema.optional(),
});

/**
 * Freeze a membership.
 *
 * Freezing preserves remaining days: the expiry date is pushed out by exactly
 * the number of frozen days when the membership is unfrozen. Without this, a
 * member who pauses for a month silently loses a month they paid for.
 */
export const freezeMembershipSchema = z
  .object({
    membershipId: cuidSchema,
    startDate: z.coerce.date(),
    /** Optional planned end. If omitted, frozen until manually unfrozen. */
    endDate: z.coerce.date().optional(),
    reason: z.string().trim().min(3, 'A reason is required').max(300),
  })
  .refine((f) => !f.endDate || f.endDate > f.startDate, {
    message: 'Freeze end date must be after the start date',
    path: ['endDate'],
  });

export type FreezeMembershipInput = z.infer<typeof freezeMembershipSchema>;

export const unfreezeMembershipSchema = z.object({
  membershipId: cuidSchema,
  /** Defaults to today. Days frozen are added back to the expiry date. */
  resumeDate: z.coerce.date().default(() => new Date()),
});

/**
 * Upgrade to a different plan mid-cycle.
 *
 * `creditRemainingDays` prorates the unused value of the current plan against
 * the new one. The resulting amount due is computed server-side — never trusted
 * from the client — and returned for confirmation before the change commits.
 */
export const upgradeMembershipSchema = z.object({
  membershipId: cuidSchema,
  newPlanId: cuidSchema,
  effectiveDate: z.coerce.date().default(() => new Date()),
  creditRemainingDays: z.boolean().default(true),
  discountAmount: z.number().int().min(0).default(0),
  notes: z.string().trim().max(500).optional(),
});

export type UpgradeMembershipInput = z.infer<typeof upgradeMembershipSchema>;

/** Transfer the remaining membership to another person. */
export const transferMembershipSchema = z.object({
  membershipId: cuidSchema,
  /** Existing member to receive it, or details to register a new one. */
  toMemberId: cuidSchema.optional(),
  transferFeePaise: paiseSchema.default(0),
  reason: z.string().trim().min(3, 'A reason is required').max(300),
});

export type TransferMembershipInput = z.infer<typeof transferMembershipSchema>;

/** Renew an expiring or expired membership. */
export const renewMembershipSchema = z.object({
  memberId: cuidSchema,
  planId: cuidSchema,
  /**
   * When true and the current membership has not yet expired, the new period
   * starts the day after expiry rather than today — so a member renewing early
   * is not penalised for it.
   */
  continueFromExpiry: z.boolean().default(true),
  startDate: z.coerce.date().optional(),
  payment: z.object({
    amountPaid: z.number().int().min(0),
    mode: z.enum(['CASH', 'UPI', 'CARD', 'NET_BANKING', 'ONLINE']),
    discountAmount: z.number().int().min(0).default(0),
    discountReason: z.string().trim().max(200).optional(),
    reference: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  // Opt-in, as on registration: Indian SMS needs DLT registration to be
  // delivered at all. The member is told by email and WhatsApp instead.
  sendSms: z.boolean().default(false),
});

export type RenewMembershipInput = z.infer<typeof renewMembershipSchema>;

/**
 * The Memberships page: every membership, newest first.
 *
 * `kind` separates sign-ups from renewals, read from the membership's
 * history; imported ones carry no history and match neither. `since`
 * narrows to memberships added today, this week or this month (IST).
 */
export const membershipQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(MembershipStatus).optional(),
  kind: z.enum(['NEW', 'RENEWAL']).optional(),
  since: z.enum(['today', 'week', 'month', 'all']).default('all'),
});

export type MembershipQuery = z.infer<typeof membershipQuerySchema>;

/** How a membership came about, for the Memberships page. */
export type MembershipKind = 'NEW' | 'RENEWAL' | 'UPGRADE' | 'TRANSFER' | 'IMPORTED';

/** One row of the Memberships page. */
export interface MembershipListItem {
  id: string;
  createdAt: string;
  startDate: string;
  endDate: string;
  status: MembershipStatus;
  kind: MembershipKind;
  plan: { id: string; name: string; durationDays: number };
  member: {
    id: string;
    memberId: string;
    fullName: string;
    phone: string;
    gender: string;
    photoUrl: string | null;
  };
  totalPaise: number;
  /** Paid against this membership, net of refunds. */
  paidPaise: number;
  balancePaise: number;
  /** Who entered it; null for imported history. */
  addedBy: string | null;
}

/** Counts behind the Memberships page summary. */
export interface MembershipActivity {
  today: { total: number; new: number; renewals: number };
  week: { total: number; new: number; renewals: number };
  month: { total: number; new: number; renewals: number };
}
