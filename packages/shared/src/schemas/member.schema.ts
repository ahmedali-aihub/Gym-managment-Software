import { z } from 'zod';
import { Gender, MemberStatus } from '../types/enums.js';
import {
  addressSchema,
  cuidSchema,
  dobSchema,
  emergencyContactSchema,
  nameSchema,
  optionalEmailSchema,
  paginationSchema,
  phoneSchema,
} from './common.schema.js';

/** Fitness goals offered at registration. Multi-select. */
export const FITNESS_GOALS = [
  'WEIGHT_LOSS',
  'MUSCLE_GAIN',
  'GENERAL_FITNESS',
  'STRENGTH',
  'ENDURANCE',
  'FLEXIBILITY',
  'SPORTS_TRAINING',
  'REHABILITATION',
] as const;

export type FitnessGoal = (typeof FITNESS_GOALS)[number];

export const FITNESS_GOAL_LABELS: Record<FitnessGoal, string> = {
  WEIGHT_LOSS: 'Weight Loss',
  MUSCLE_GAIN: 'Muscle Gain',
  GENERAL_FITNESS: 'General Fitness',
  STRENGTH: 'Strength Training',
  ENDURANCE: 'Endurance',
  FLEXIBILITY: 'Flexibility',
  SPORTS_TRAINING: 'Sports Training',
  REHABILITATION: 'Rehabilitation',
};

/**
 * Member registration.
 *
 * This single payload creates the member, their first membership, the opening
 * payment, and triggers the welcome SMS — all inside one transaction, because
 * a member row without a membership is not a state the front desk should see.
 */
export const createMemberSchema = z.object({
  // ── Identity ───────────────────────────────────────────────
  fullName: nameSchema,
  phone: phoneSchema,
  email: optionalEmailSchema,
  dateOfBirth: dobSchema,
  gender: z.nativeEnum(Gender),

  /**
   * Base64 data URL from the webcam capture, or an uploaded file.
   * Validated for size at the route layer, where the raw body is available.
   */
  photoDataUrl: z
    .string()
    .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/, 'Invalid image format')
    .optional(),

  // ── Contact ────────────────────────────────────────────────
  address: addressSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),

  // ── Fitness profile ────────────────────────────────────────
  goals: z.array(z.enum(FITNESS_GOALS)).max(4, 'Pick at most 4 goals').default([]),
  medicalNotes: z.string().trim().max(1000).optional(),

  // ── Membership (creates the first membership period) ───────
  planId: cuidSchema,
  startDate: z.coerce.date().default(() => new Date()),
  trainerId: cuidSchema.optional(),

  // ── Opening payment ────────────────────────────────────────
  payment: z
    .object({
      /**
       * What the member actually handed over now. May be less than the plan
       * price (partial payment) or zero (pay later) — both are real situations
       * at the desk, and the difference becomes a tracked due.
       */
      amountPaid: z.number().int().min(0),
      mode: z.enum(['CASH', 'UPI', 'CARD', 'NET_BANKING', 'ONLINE']),
      /** Discount applied to the plan price, in paise. Needs a reason if > 0. */
      discountAmount: z.number().int().min(0).default(0),
      discountReason: z.string().trim().max(200).optional(),
      /** Joining/admission fee, in paise. */
      joiningFee: z.number().int().min(0).default(0),
      reference: z.string().trim().max(100).optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .refine((p) => p.discountAmount === 0 || Boolean(p.discountReason?.trim()), {
      message: 'A reason is required when a discount is applied',
      path: ['discountReason'],
    }),

  // Opt-IN. Indian SMS needs DLT registration to deliver; WhatsApp and
  // email reach the member today at no cost and are sent automatically.
  sendWelcomeSms: z.boolean().default(false),
});

export type CreateMemberInput = z.input<typeof createMemberSchema>;
export type CreateMemberPayload = z.output<typeof createMemberSchema>;

/**
 * Updating a member never touches membership or payment state — those have
 * their own audited endpoints (freeze, upgrade, transfer, record payment).
 */
export const updateMemberSchema = z.object({
  fullName: nameSchema.optional(),
  phone: phoneSchema.optional(),
  email: optionalEmailSchema,
  dateOfBirth: dobSchema.optional(),
  gender: z.nativeEnum(Gender).optional(),
  photoDataUrl: z
    .string()
    .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/, 'Invalid image format')
    .optional(),
  address: addressSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),
  goals: z.array(z.enum(FITNESS_GOALS)).max(4).optional(),
  medicalNotes: z.string().trim().max(1000).optional(),
  trainerId: cuidSchema.nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/**
 * yyyy-MM-dd parsed as a LOCAL date, not UTC.
 *
 * `new Date('2026-09-01')` is UTC midnight — 05:30 IST on the 1st. Used as a
 * range start that silently excludes the first five and a half hours of the
 * day; used as a range end it excludes almost the entire day. Both are the
 * kind of bug that looks like missing data rather than a timezone error.
 *
 * `start` anchors to 00:00:00.000 local, `end` to 23:59:59.999 local, so a
 * range always covers whole days.
 */
function localDate(edge: 'start' | 'end') {
  return z
    .union([z.string(), z.date()])
    .transform((value, ctx) => {
      if (value instanceof Date) return value;

      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      if (!match) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected a date as yyyy-MM-dd',
        });
        return z.NEVER;
      }

      const [, year, month, day] = match;
      const date = new Date(Number(year), Number(month) - 1, Number(day));

      // Rejects 2026-02-31, which would otherwise roll forward into March.
      if (
        date.getFullYear() !== Number(year) ||
        date.getMonth() !== Number(month) - 1 ||
        date.getDate() !== Number(day)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Not a real calendar date',
        });
        return z.NEVER;
      }

      if (edge === 'end') date.setHours(23, 59, 59, 999);
      return date;
    });
}

const localDateStart = localDate('start');
const localDateEnd = localDate('end');

/**
 * Member list filters.
 * `expiringInDays` powers the "expiring in 7 days" card and the reminder flow.
 */
export const memberQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(MemberStatus).optional(),
  planId: cuidSchema.optional(),
  trainerId: cuidSchema.optional(),
  gender: z.nativeEnum(Gender).optional(),
  expiringInDays: z.coerce.number().int().min(0).max(365).optional(),
  hasDues: z.coerce.boolean().optional(),
  /**
   * Date-range filters.
   *
   * `localDate` rather than `z.coerce.date()`: "2026-09-01" parses as UTC
   * midnight, which in IST is 05:30 on the 1st — so a range starting on the
   * 1st would silently drop everything before 05:30 that morning.
   *
   * `joined*` answers "who did we sign up?"; `expiring*` answers "whose
   * membership ends in this window?" — the renewal-chasing question.
   */
  joinedFrom: localDateStart.optional(),
  joinedTo: localDateEnd.optional(),
  expiringFrom: localDateStart.optional(),
  expiringTo: localDateEnd.optional(),

  /**
   * Filter by training focus.
   *
   * Accepts a single goal or a comma-separated list, matching ANY of them.
   * The comma form keeps the filter shareable as a URL — "show me everyone
   * doing weight loss or cardio" is one link.
   */
  goals: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      const list = Array.isArray(value) ? value : value.split(',');
      const valid = list
        .map((item) => item.trim().toUpperCase())
        .filter((item): item is FitnessGoal =>
          (FITNESS_GOALS as readonly string[]).includes(item),
        );
      return valid.length > 0 ? valid : undefined;
    }),
});

export type MemberQuery = z.infer<typeof memberQuerySchema>;

/** Counts behind the member-list summary strip. */
export interface MemberStats {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  frozen: number;
  cancelled: number;
  totalDuesPaise: number;
}
