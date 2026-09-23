import { rupeesToPaise } from '@azf/shared';
import { describe, expect, it } from 'vitest';
import {
  calculateBalance,
  calculateBill,
  calculateProratedCredit,
  calculateUpgradeDue,
  derivePaymentStatus,
} from '../../src/modules/payments/billing.js';

/**
 * Billing arithmetic tests.
 *
 * Configured for A to Z Fitness's actual situation: NOT GST registered, so
 * every bill is a plain receipt with no tax component. The GST branches are
 * exercised separately in gst.test.ts by overriding the config.
 */

describe('calculateBill — not GST registered', () => {
  it('totals a plain membership with no tax', () => {
    const bill = calculateBill({ pricePaise: rupeesToPaise(4000) });

    expect(bill.subtotalPaise).toBe(400000);
    expect(bill.totalPaise).toBe(400000);
    expect(bill.taxPaise).toBe(0);
    expect(bill.cgstPaise).toBe(0);
    expect(bill.sgstPaise).toBe(0);
    expect(bill.isGstInvoice).toBe(false);
    expect(bill.gstRate).toBe(0);
  });

  it('adds a joining fee to the subtotal', () => {
    const bill = calculateBill({
      pricePaise: rupeesToPaise(1500),
      joiningFeePaise: rupeesToPaise(500),
    });

    expect(bill.subtotalPaise).toBe(200000);
    expect(bill.totalPaise).toBe(200000);
  });

  it('subtracts a discount', () => {
    const bill = calculateBill({
      pricePaise: rupeesToPaise(12000),
      discountPaise: rupeesToPaise(2000),
    });

    expect(bill.discountPaise).toBe(200000);
    expect(bill.totalPaise).toBe(1000000);
  });

  it('caps a discount at the subtotal, never producing a negative total', () => {
    // A typo entering ₹50,000 discount on a ₹4,000 plan must not create a
    // negative bill that would read as the gym owing the member money.
    const bill = calculateBill({
      pricePaise: rupeesToPaise(4000),
      discountPaise: rupeesToPaise(50000),
    });

    expect(bill.discountPaise).toBe(400000);
    expect(bill.totalPaise).toBe(0);
  });

  it('handles a free membership', () => {
    const bill = calculateBill({ pricePaise: 0 });
    expect(bill.totalPaise).toBe(0);
  });

  it('rejects a non-integer amount', () => {
    // Guards against a float sneaking in from the client.
    expect(() => calculateBill({ pricePaise: 1500.5 })).toThrow(/integer/);
  });

  it('rejects a negative amount', () => {
    expect(() => calculateBill({ pricePaise: -100 })).toThrow(/negative/);
  });

  it('never loses a paise across the breakdown', () => {
    for (const rupees of [1499, 2500, 3333, 4999, 7777, 12345]) {
      const bill = calculateBill({
        pricePaise: rupeesToPaise(rupees),
        joiningFeePaise: rupeesToPaise(499),
        discountPaise: rupeesToPaise(100),
      });

      expect(bill.totalPaise).toBe(
        bill.subtotalPaise - bill.discountPaise + bill.taxPaise,
      );
    }
  });
});

describe('calculateProratedCredit', () => {
  it('credits the unused portion of a plan', () => {
    // ₹4,000 quarterly (90 days), 45 days left → half the value.
    const credit = calculateProratedCredit({
      totalPaidPaise: rupeesToPaise(4000),
      totalDays: 90,
      remainingDays: 45,
    });

    expect(credit).toBe(rupeesToPaise(2000));
  });

  it('returns nothing for an expired membership', () => {
    expect(
      calculateProratedCredit({
        totalPaidPaise: rupeesToPaise(4000),
        totalDays: 90,
        remainingDays: 0,
      }),
    ).toBe(0);
  });

  it('returns nothing when the membership is already overdue', () => {
    expect(
      calculateProratedCredit({
        totalPaidPaise: rupeesToPaise(4000),
        totalDays: 90,
        remainingDays: -10,
      }),
    ).toBe(0);
  });

  it('never credits more than was paid', () => {
    // Remaining days exceeding total days would otherwise over-credit.
    const credit = calculateProratedCredit({
      totalPaidPaise: rupeesToPaise(4000),
      totalDays: 90,
      remainingDays: 200,
    });

    expect(credit).toBeLessThanOrEqual(rupeesToPaise(4000));
  });

  it('floors to whole paise rather than drifting', () => {
    // ₹1,000 over 30 days, 7 days left = 23333.33 paise.
    const credit = calculateProratedCredit({
      totalPaidPaise: rupeesToPaise(1000),
      totalDays: 30,
      remainingDays: 7,
    });

    expect(Number.isInteger(credit)).toBe(true);
    expect(credit).toBe(23333);
  });

  it('does not compound rounding loss across remaining days', () => {
    // Regression guard. Flooring a per-day rate and multiplying loses money:
    // ₹4,000/90 days floors to 4,444 paise/day, and 4,444 × 45 = 199,980 —
    // 20 paise short of the ₹2,000 actually owed. Flooring the proportion
    // once keeps the error to at most a single paise.
    const credit = calculateProratedCredit({
      totalPaidPaise: rupeesToPaise(4000),
      totalDays: 90,
      remainingDays: 45,
    });

    expect(credit).toBe(rupeesToPaise(2000));
  });

  it('keeps the error under one paise across many awkward ratios', () => {
    const cases = [
      { paid: 400000, total: 90, remaining: 45 },
      { paid: 150000, total: 30, remaining: 11 },
      { paid: 700000, total: 180, remaining: 97 },
      { paid: 1200000, total: 365, remaining: 200 },
      { paid: 99999, total: 7, remaining: 3 },
    ];

    for (const { paid, total, remaining } of cases) {
      const credit = calculateProratedCredit({
        totalPaidPaise: paid,
        totalDays: total,
        remainingDays: remaining,
      });

      const exact = (paid * remaining) / total;
      expect(exact - credit).toBeGreaterThanOrEqual(0);
      expect(exact - credit).toBeLessThan(1);
    }
  });
});

describe('calculateUpgradeDue', () => {
  it('applies credit against the new plan', () => {
    // Upgrading to ₹12,000 yearly with ₹2,000 credit → ₹10,000 due.
    const result = calculateUpgradeDue({
      newPlanPricePaise: rupeesToPaise(12000),
      creditPaise: rupeesToPaise(2000),
    });

    expect(result.duePaise).toBe(rupeesToPaise(10000));
    expect(result.creditAppliedPaise).toBe(rupeesToPaise(2000));
  });

  it('applies a discount before the credit', () => {
    const result = calculateUpgradeDue({
      newPlanPricePaise: rupeesToPaise(12000),
      creditPaise: rupeesToPaise(2000),
      discountPaise: rupeesToPaise(1000),
    });

    expect(result.duePaise).toBe(rupeesToPaise(9000));
  });

  it('never returns a negative due when credit exceeds the new plan', () => {
    // Downgrading: the excess credit is not automatically refunded.
    const result = calculateUpgradeDue({
      newPlanPricePaise: rupeesToPaise(1500),
      creditPaise: rupeesToPaise(8000),
    });

    expect(result.duePaise).toBe(0);
    expect(result.creditAppliedPaise).toBe(rupeesToPaise(1500));
  });
});

describe('calculateBalance', () => {
  it('is zero when fully paid', () => {
    expect(
      calculateBalance({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: rupeesToPaise(4000),
      }),
    ).toBe(0);
  });

  it('reports the shortfall on a partial payment', () => {
    expect(
      calculateBalance({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: rupeesToPaise(2500),
      }),
    ).toBe(rupeesToPaise(1500));
  });

  it('re-opens the balance when a payment is refunded', () => {
    // Paid 4000, refunded 1000 → 1000 owed again, not zero.
    expect(
      calculateBalance({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: rupeesToPaise(4000),
        totalRefundedPaise: rupeesToPaise(1000),
      }),
    ).toBe(rupeesToPaise(1000));
  });

  it('never goes negative on an overpayment', () => {
    expect(
      calculateBalance({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: rupeesToPaise(5000),
      }),
    ).toBe(0);
  });
});

describe('derivePaymentStatus', () => {
  it('is PAID when nothing is outstanding', () => {
    expect(
      derivePaymentStatus({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: rupeesToPaise(4000),
      }),
    ).toBe('PAID');
  });

  it('is PARTIAL when something was paid but a balance remains', () => {
    expect(
      derivePaymentStatus({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: rupeesToPaise(1000),
      }),
    ).toBe('PARTIAL');
  });

  it('is PENDING when nothing has been paid', () => {
    expect(
      derivePaymentStatus({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: 0,
      }),
    ).toBe('PENDING');
  });

  it('returns to PENDING when the only payment is fully refunded', () => {
    expect(
      derivePaymentStatus({
        totalBilledPaise: rupeesToPaise(4000),
        totalPaidPaise: rupeesToPaise(4000),
        totalRefundedPaise: rupeesToPaise(4000),
      }),
    ).toBe('PENDING');
  });
});

describe('real A to Z Fitness scenarios', () => {
  it('monthly plan paid in full by cash', () => {
    const bill = calculateBill({ pricePaise: rupeesToPaise(1500) });
    const status = derivePaymentStatus({
      totalBilledPaise: bill.totalPaise,
      totalPaidPaise: rupeesToPaise(1500),
    });

    expect(bill.totalPaise).toBe(rupeesToPaise(1500));
    expect(status).toBe('PAID');
  });

  it('quarterly plan with a joining fee, half paid now', () => {
    const bill = calculateBill({
      pricePaise: rupeesToPaise(4000),
      joiningFeePaise: rupeesToPaise(500),
    });

    expect(bill.totalPaise).toBe(rupeesToPaise(4500));

    const balance = calculateBalance({
      totalBilledPaise: bill.totalPaise,
      totalPaidPaise: rupeesToPaise(2000),
    });

    expect(balance).toBe(rupeesToPaise(2500));
    expect(
      derivePaymentStatus({
        totalBilledPaise: bill.totalPaise,
        totalPaidPaise: rupeesToPaise(2000),
      }),
    ).toBe('PARTIAL');
  });

  it('yearly plan with a festive discount', () => {
    const bill = calculateBill({
      pricePaise: rupeesToPaise(12000),
      discountPaise: rupeesToPaise(1500),
    });

    expect(bill.totalPaise).toBe(rupeesToPaise(10500));
  });

  it('mid-cycle upgrade from quarterly to yearly', () => {
    // 45 of 90 days used on a ₹4,000 quarterly plan.
    const credit = calculateProratedCredit({
      totalPaidPaise: rupeesToPaise(4000),
      totalDays: 90,
      remainingDays: 45,
    });

    const bill = calculateBill({ pricePaise: rupeesToPaise(12000) });
    const { duePaise } = calculateUpgradeDue({
      newPlanPricePaise: bill.totalPaise,
      creditPaise: credit,
    });

    expect(credit).toBe(rupeesToPaise(2000));
    expect(duePaise).toBe(rupeesToPaise(10000));
  });
});
