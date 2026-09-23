/**
 * Money handling.
 *
 * RULE: every monetary amount crossing the wire or hitting the database is an
 * INTEGER NUMBER OF PAISE. Never a float. 0.1 + 0.2 !== 0.3 in IEEE-754, and a
 * gym reconciling cash at the end of the day cannot absorb drift.
 *
 * Rupees appear only at the UI boundary, via formatINR()/rupeesToPaise().
 */

export const PAISE_PER_RUPEE = 100;

/** Largest amount we accept in a single transaction: ₹10,00,000. Guards typos. */
export const MAX_TRANSACTION_PAISE = 10_00_000 * PAISE_PER_RUPEE;

/**
 * Convert a rupee amount (as typed by a human) to integer paise.
 * Rounds to the nearest paise — callers should validate the input first.
 *
 * @example rupeesToPaise(1500)    // 150000
 * @example rupeesToPaise(1500.50) // 150050
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** Convert integer paise back to a rupee number. Use only for display/export. */
export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/**
 * Format paise as Indian-locale currency: ₹1,50,000.00
 * Note the Indian digit grouping (lakh/crore), not the Western thousands one.
 */
export function formatINR(
  paise: number,
  options: { showDecimals?: boolean; showSymbol?: boolean } = {},
): string {
  const { showDecimals = true, showSymbol = true } = options;
  const rupees = paiseToRupees(paise);

  const formatted = new Intl.NumberFormat('en-IN', {
    style: showSymbol ? 'currency' : 'decimal',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(rupees);

  return formatted;
}

/**
 * Compact Indian format for dashboard KPI cards: ₹1.5L, ₹2.3Cr, ₹45K
 * Falls back to full format below ₹1,000.
 */
export function formatINRCompact(paise: number): string {
  const rupees = paiseToRupees(paise);
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? '-' : '';

  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/**
 * Amount in words, for invoices/receipts. Indian numbering system.
 * @example amountInWords(150000) // "One Lakh Fifty Thousand Rupees Only"
 */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paiseToRupees(paise));
  const remainingPaise = paise % PAISE_PER_RUPEE;

  if (rupees === 0 && remainingPaise === 0) return 'Zero Rupees Only';

  const words = numberToIndianWords(rupees);
  const base = words ? `${words} Rupees` : '';
  const paiseWords =
    remainingPaise > 0 ? ` and ${numberToIndianWords(remainingPaise)} Paise` : '';

  return `${base}${paiseWords} Only`.trim();
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
] as const;

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty',
  'Ninety',
] as const;

/** Handles 0–99. */
function twoDigitsToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n] ?? '';
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const ones = ONES[n % 10] ?? '';
  return ones ? `${tens} ${ones}` : tens;
}

/** Indian grouping: crore, lakh, thousand, hundred. */
function numberToIndianWords(n: number): string {
  if (n === 0) return '';

  const parts: string[] = [];

  const crore = Math.floor(n / 1_00_00_000);
  if (crore > 0) {
    parts.push(`${numberToIndianWords(crore)} Crore`);
    n %= 1_00_00_000;
  }

  const lakh = Math.floor(n / 1_00_000);
  if (lakh > 0) {
    parts.push(`${twoDigitsToWords(lakh)} Lakh`);
    n %= 1_00_000;
  }

  const thousand = Math.floor(n / 1_000);
  if (thousand > 0) {
    parts.push(`${twoDigitsToWords(thousand)} Thousand`);
    n %= 1_000;
  }

  const hundred = Math.floor(n / 100);
  if (hundred > 0) {
    parts.push(`${ONES[hundred]} Hundred`);
    n %= 100;
  }

  const rest = twoDigitsToWords(n);
  if (rest) parts.push(rest);

  return parts.join(' ');
}
