import { z } from 'zod';
import { PaymentMode, PaymentStatus } from '../types/enums.js';
import {
  cuidSchema,
  paginationSchema,
  paiseSchema,
  positivePaiseSchema,
} from './common.schema.js';

/**
 * Record a payment against a member.
 *
 * The server recomputes what is owed and rejects overpayment — the client
 * never dictates the balance. `idempotencyKey` guards the real failure mode at
 * a busy front desk: a double-click or a retried request creating two receipts
 * for one handover of cash.
 */
export const recordPaymentSchema = z
  .object({
    memberId: cuidSchema,
    /** Membership this payment settles. Omit for ad-hoc charges. */
    membershipId: cuidSchema.optional(),
    amountPaise: positivePaiseSchema,
    mode: z.nativeEnum(PaymentMode),
    paidAt: z.coerce.date().default(() => new Date()),

    /** UPI txn ID, cheque number, card auth code — whatever the mode implies. */
    reference: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),

    discountAmount: paiseSchema.default(0),
    discountReason: z.string().trim().max(200).optional(),

    /** Generate and store a PDF receipt for this payment. */
    generateInvoice: z.boolean().default(true),
    sendSms: z.boolean().default(true),

    idempotencyKey: z.string().uuid().optional(),
  })
  .refine((p) => p.discountAmount === 0 || Boolean(p.discountReason?.trim()), {
    message: 'A reason is required when a discount is applied',
    path: ['discountReason'],
  })
  .refine(
    (p) =>
      // A UPI or card payment without a reference cannot be reconciled against
      // the bank statement later. Cash legitimately has none.
      p.mode === PaymentMode.CASH || Boolean(p.reference?.trim()),
    {
      message: 'A transaction reference is required for non-cash payments',
      path: ['reference'],
    },
  );

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
export type RecordPaymentPayload = z.output<typeof recordPaymentSchema>;

export const paymentQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  memberId: cuidSchema.optional(),
  mode: z.nativeEnum(PaymentMode).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minAmount: z.coerce.number().int().min(0).optional(),
  maxAmount: z.coerce.number().int().min(0).optional(),
});

export type PaymentQuery = z.infer<typeof paymentQuerySchema>;

/** Refund an existing payment, fully or in part. */
export const refundPaymentSchema = z.object({
  paymentId: cuidSchema,
  amountPaise: positivePaiseSchema,
  reason: z.string().trim().min(3, 'A reason is required').max(300),
  mode: z.nativeEnum(PaymentMode),
  reference: z.string().trim().max(100).optional(),
});

export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

/** Create a Razorpay order for an online payment or UPI link. */
export const createPaymentOrderSchema = z.object({
  memberId: cuidSchema,
  membershipId: cuidSchema.optional(),
  amountPaise: positivePaiseSchema,
  /** Send the generated payment link to the member by SMS. */
  sendLink: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
});

export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;

/** Razorpay checkout callback — verified against the HMAC signature. */
export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

/**
 * A member's money position. Every figure is in paise.
 * `balanceDuePaise` is the number the front desk actually asks for.
 */
export interface MemberBalance {
  totalBilledPaise: number;
  totalPaidPaise: number;
  totalDiscountPaise: number;
  totalRefundedPaise: number;
  balanceDuePaise: number;
  lastPaymentAt: string | null;
  status: PaymentStatus;
}

/** Totals behind the payments list and revenue KPIs. */
export interface PaymentStats {
  collectedPaise: number;
  pendingPaise: number;
  refundedPaise: number;
  discountPaise: number;
  transactionCount: number;
  byMode: Record<PaymentMode, { count: number; amountPaise: number }>;
}
