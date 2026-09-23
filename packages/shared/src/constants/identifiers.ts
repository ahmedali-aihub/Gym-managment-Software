/**
 * Human-facing identifiers.
 *
 * These are printed on ID cards, spoken over the phone, and typed at the front
 * desk — so they are short, unambiguous, and year-scoped. They are NOT the
 * primary keys; the database uses cuids internally.
 */

/** AZF-2026-0001 — Member ID, sequential within a calendar year. */
export const MEMBER_ID_PREFIX = 'AZF';
export const MEMBER_ID_PATTERN = /^AZF-\d{4}-\d{4,}$/;
export const MEMBER_ID_SEQUENCE_PAD = 4;

export function formatMemberId(year: number, sequence: number): string {
  return `${MEMBER_ID_PREFIX}-${year}-${String(sequence).padStart(MEMBER_ID_SEQUENCE_PAD, '0')}`;
}

export function parseMemberId(
  memberId: string,
): { year: number; sequence: number } | null {
  const match = /^AZF-(\d{4})-(\d{4,})$/.exec(memberId.trim().toUpperCase());
  if (!match?.[1] || !match[2]) return null;
  return { year: Number(match[1]), sequence: Number(match[2]) };
}

/** INV/2026-27/0001 — Invoice number, scoped to the Indian financial year. */
export const INVOICE_PREFIX = 'INV';
export const INVOICE_NUMBER_PATTERN = /^INV\/\d{4}-\d{2}\/\d{4,}$/;

export function formatInvoiceNumber(
  financialYear: string,
  sequence: number,
): string {
  return `${INVOICE_PREFIX}/${financialYear}/${String(sequence).padStart(4, '0')}`;
}

/** RCPT/2026-27/0001 — Receipt number for non-invoice payments. */
export const RECEIPT_PREFIX = 'RCPT';

export function formatReceiptNumber(
  financialYear: string,
  sequence: number,
): string {
  return `${RECEIPT_PREFIX}/${financialYear}/${String(sequence).padStart(4, '0')}`;
}

/**
 * Indian mobile number.
 * Accepts 10 digits starting 6-9, with optional +91 / 91 / 0 prefix.
 */
export const INDIAN_MOBILE_PATTERN = /^(?:\+?91|0)?[6-9]\d{9}$/;

/** Strip prefixes and spacing down to the bare 10 digits for storage. */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** +91 98765 43210 — display form. */
export function formatPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (n.length !== 10) return phone;
  return `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
}

/** E.164, required by every SMS provider. */
export function toE164(phone: string): string {
  return `+91${normalizePhone(phone)}`;
}

/** GSTIN — 15 chars: 2 state + 10 PAN + 1 entity + 'Z' + 1 checksum. */
export const GSTIN_PATTERN =
  /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}$/;

/** Indian PIN code — 6 digits, cannot start with 0. */
export const PINCODE_PATTERN = /^[1-9]\d{5}$/;

/**
 * Payload encoded in a member's check-in QR code.
 * Kept deliberately small so low-end scanners read it reliably, and
 * namespaced so a random QR cannot be mistaken for a member pass.
 */
export const QR_PAYLOAD_PREFIX = 'AZF:MEMBER:';

export function buildQrPayload(memberId: string, token: string): string {
  return `${QR_PAYLOAD_PREFIX}${memberId}:${token}`;
}

export function parseQrPayload(
  payload: string,
): { memberId: string; token: string } | null {
  if (!payload.startsWith(QR_PAYLOAD_PREFIX)) return null;
  const rest = payload.slice(QR_PAYLOAD_PREFIX.length);
  const separatorIndex = rest.lastIndexOf(':');
  if (separatorIndex <= 0) return null;
  const memberId = rest.slice(0, separatorIndex);
  const token = rest.slice(separatorIndex + 1);
  if (!memberId || !token) return null;
  return { memberId, token };
}
