import { taxConfig } from '../../config/env.js';

/**
 * Billing arithmetic.
 *
 * Every rupee figure in the system passes through here. Keeping the maths in
 * one pure, dependency-free module means it can be tested exhaustively and
 * reviewed as a unit — rather than being re-derived slightly differently in
 * each of registration, renewal, upgrade and invoice rendering.
 *
 * All inputs and outputs are integer PAISE.
 */

export interface LineItemInput {
  /** Plan price at the time of purchase. */
  pricePaise: number;
  /** One-time admission fee, if any. */
  joiningFeePaise?: number;
  discountPaise?: number;
}

export interface BillBreakdown {
  subtotalPaise: number;
  discountPaise: number;
  /** Amount the tax is computed on (or would be, if registered). */
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** Snapshot of the tax settings applied. */
  gstRate: number;
  isGstInvoice: boolean;
}

/**
 * Compute the full breakdown for a membership sale.
 *
 * A to Z Fitness is not currently GST registered, so `taxConfig.rate` is 0 and
 * this produces a plain receipt: subtotal − discount = total. The tax branches
 * are live code rather than placeholders, so registering later is a config
 * change.
 *
 * Intra-state supply (gym and member both in Telangana) splits tax into
 * CGST + SGST. IGST would apply only to inter-state supply, which a walk-in
 * gym does not have — it is computed for completeness, never populated here.
 */
export function calculateBill(input: LineItemInput): BillBreakdown {
  const { pricePaise, joiningFeePaise = 0, discountPaise = 0 } = input;

  assertNonNegativeInteger(pricePaise, 'pricePaise');
  assertNonNegativeInteger(joiningFeePaise, 'joiningFeePaise');
  assertNonNegativeInteger(discountPaise, 'discountPaise');

  const subtotalPaise = pricePaise + joiningFeePaise;

  // A discount cannot exceed what is being charged.
  const effectiveDiscount = Math.min(discountPaise, subtotalPaise);
  const netPaise = subtotalPaise - effectiveDiscount;

  const gstRate = taxConfig.rate;
  const isGstInvoice = taxConfig.isRegistered && gstRate > 0;

  if (!isGstInvoice) {
    return {
      subtotalPaise,
      discountPaise: effectiveDiscount,
      taxablePaise: netPaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      taxPaise: 0,
      totalPaise: netPaise,
      gstRate: 0,
      isGstInvoice: false,
    };
  }

  let taxablePaise: number;
  let taxPaise: number;

  if (taxConfig.pricesIncludeTax) {
    // Displayed price already contains tax; extract the taxable base.
    // taxable = gross * 100 / (100 + rate)
    taxablePaise = Math.round((netPaise * 100) / (100 + gstRate));
    taxPaise = netPaise - taxablePaise;
  } else {
    taxablePaise = netPaise;
    taxPaise = Math.round((netPaise * gstRate) / 100);
  }

  // Split evenly, giving any odd paise to CGST so the halves still sum to the
  // total. Letting both halves round independently can drift by one paise.
  const cgstPaise = Math.ceil(taxPaise / 2);
  const sgstPaise = taxPaise - cgstPaise;

  return {
    subtotalPaise,
    discountPaise: effectiveDiscount,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise: 0,
    taxPaise,
    totalPaise: taxablePaise + taxPaise,
    gstRate,
    isGstInvoice: true,
  };
}

/**
 * Prorated credit for the unused portion of a membership, used when a member
 * upgrades mid-cycle.
 *
 * The proportion is applied to the full amount and floored ONCE, rather than
 * flooring a per-day rate and multiplying. Flooring per day compounds the
 * rounding loss across every remaining day: ₹4,000 over 90 days is 4,444.44
 * paise/day, so a floored 4,444 × 45 days silently loses 20 paise of the
 * member's money. Flooring once caps the loss at a single paise.
 */
export function calculateProratedCredit(params: {
  totalPaidPaise: number;
  totalDays: number;
  remainingDays: number;
}): number {
  const { totalPaidPaise, totalDays, remainingDays } = params;

  if (totalDays <= 0 || remainingDays <= 0) return 0;

  const usableDays = Math.min(remainingDays, totalDays);

  return Math.max(0, Math.floor((totalPaidPaise * usableDays) / totalDays));
}

/**
 * What a member owes on an upgrade: the new plan's cost, less credit for the
 * unused days of the old one, less any discount. Never negative — a downgrade
 * produces zero due rather than a refund owed, which is a deliberate policy
 * choice and should be handled explicitly as a refund if the gym wants it.
 */
export function calculateUpgradeDue(params: {
  newPlanPricePaise: number;
  creditPaise: number;
  discountPaise?: number;
}): { duePaise: number; creditAppliedPaise: number } {
  const { newPlanPricePaise, creditPaise, discountPaise = 0 } = params;

  const afterDiscount = Math.max(0, newPlanPricePaise - discountPaise);
  const creditApplied = Math.min(creditPaise, afterDiscount);

  return {
    duePaise: afterDiscount - creditApplied,
    creditAppliedPaise: creditApplied,
  };
}

export interface BalanceInput {
  totalBilledPaise: number;
  totalPaidPaise: number;
  totalRefundedPaise?: number;
}

/**
 * Outstanding balance.
 *
 * Refunds increase what is owed again: a member who paid ₹4,000, was refunded
 * ₹1,000, and owes ₹4,000 has a ₹1,000 balance — not zero.
 */
export function calculateBalance(input: BalanceInput): number {
  const { totalBilledPaise, totalPaidPaise, totalRefundedPaise = 0 } = input;
  return Math.max(0, totalBilledPaise - totalPaidPaise + totalRefundedPaise);
}

/** Derive a payment status from billed-vs-paid. */
export function derivePaymentStatus(
  input: BalanceInput,
): 'PAID' | 'PARTIAL' | 'PENDING' {
  const { totalPaidPaise, totalRefundedPaise = 0 } = input;
  const netPaid = totalPaidPaise - totalRefundedPaise;
  const balance = calculateBalance(input);

  if (balance === 0) return 'PAID';
  if (netPaid > 0) return 'PARTIAL';
  return 'PENDING';
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(
      `${field} must be an integer number of paise, received ${value}`,
    );
  }
  if (value < 0) {
    throw new Error(`${field} cannot be negative, received ${value}`);
  }
}
