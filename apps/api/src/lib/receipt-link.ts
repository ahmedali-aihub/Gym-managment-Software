import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Shareable links to a receipt PDF — what the member taps in the WhatsApp
 * message the front desk sends.
 *
 * WhatsApp gives a website no way to attach a file to a message it opens,
 * so the receipt travels as a link. The PDF carries the member's name,
 * phone and payments, so the link must be impossible to guess or to walk
 * from one receipt to the next: the token is the invoice id plus an HMAC of
 * it, compared in constant time. An invoice id alone opens nothing.
 *
 * Keyed by RECEIPT_LINK_SECRET when set, otherwise by a key derived from
 * JWT_REFRESH_SECRET so links work with no extra setup. Changing whichever
 * key is in use invalidates every link already sent.
 */

/** 22 base64url characters: 132 bits, far beyond guessing. */
const SIGNATURE_LENGTH = 22;

function signingKey(): Buffer {
  return env.RECEIPT_LINK_SECRET
    ? Buffer.from(env.RECEIPT_LINK_SECRET)
    : createHmac('sha256', env.JWT_REFRESH_SECRET)
        .update('azf:receipt-link:v1')
        .digest();
}

function signature(invoiceId: string): string {
  return createHmac('sha256', signingKey())
    .update(invoiceId)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

export function receiptToken(invoiceId: string): string {
  return `${invoiceId}.${signature(invoiceId)}`;
}

/** The invoice id inside a genuine token; null for anything forged or mangled. */
export function invoiceIdFromToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const invoiceId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(invoiceId));

  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? invoiceId : null;
}

/** The public address of a receipt, for a message to the member. */
export function receiptUrl(invoiceId: string): string {
  const base = env.WEB_BASE_URL.replace(/\/+$/, '');
  return `${base}/api/r/${receiptToken(invoiceId)}`;
}
