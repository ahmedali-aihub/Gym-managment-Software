import { toE164 } from './identifiers.js';

/**
 * Messages the front desk sends from its own WhatsApp.
 *
 * The app opens WhatsApp on the member's chat with one of these already
 * typed, and the receptionist presses Send. No Meta account, no per-message
 * charge, no template approval — but also no attachments: WhatsApp lets a
 * link pre-fill text only, so the receipt goes as a signed link the member
 * taps to open the PDF.
 *
 * All three share one layout, so they read as coming from a business rather
 * than a personal chat: the gym's name and the document title as a
 * letterhead, a formal greeting, one labelled fact per line, and a signed
 * close. WhatsApp renders *text* bold and _text_ italic.
 *
 * No emoji: they read as casual, and a receipt or reminder from a business
 * should look like one. Bold labels carry the structure instead.
 *
 * Lines for values that do not apply are left out entirely rather than shown
 * blank.
 */

/** What every message can sign off with. */
interface Signature {
  gymName: string;
  /** "Mehdipatnam, Hyderabad" — under the name in the sign-off. */
  gymLocation?: string;
  /** Left out while the gym phone is still the placeholder. */
  gymPhone?: string;
}

const RULE = '━━━━━━━━━━━━━━━━';

function letterhead(gymName: string, title: string): string[] {
  return [`*${gymName.toUpperCase()}*`, `_${title}_`, RULE, ''];
}

function signOff(v: Signature, contactLine?: string): string[] {
  const lines: string[] = [];
  if (contactLine) lines.push(contactLine, '');
  lines.push('Warm regards,', `*Team ${v.gymName}*`);
  if (v.gymLocation) lines.push(v.gymLocation);
  return lines;
}

const callUs = (phone: string | undefined, fallback?: string) =>
  phone ? `For any assistance, call us on ${phone}.` : fallback;

export interface WelcomeChatVariables extends Signature {
  /** First name. */
  name: string;
  memberId: string;
  plan: string;
  validFrom: string;
  validUntil: string;
  /** "1,500" — omitted when nothing was paid at registration. */
  amountPaid?: string;
  paymentMode?: string;
  /** Only when something is still owed. */
  balanceDue?: string;
  receiptNumber?: string;
  receiptUrl?: string;
}

export function welcomeChatMessage(v: WelcomeChatVariables): string {
  const lines = [
    ...letterhead(v.gymName, 'Membership Confirmation'),
    `Dear ${v.name},`,
    '',
    `Welcome to *${v.gymName}*! Your membership is now active, and we look forward to being part of your fitness journey.`,
    '',
    `*Member ID:* ${v.memberId}`,
    `*Plan:* ${v.plan}`,
    `*Start Date:* ${v.validFrom}`,
    `*Valid Till:* ${v.validUntil}`,
  ];

  const payment: string[] = [];
  if (v.amountPaid) {
    payment.push(
      `*Amount Paid:* ₹${v.amountPaid}${v.paymentMode ? ` (${v.paymentMode})` : ''}`,
    );
  }
  if (v.balanceDue) payment.push(`*Balance Due:* ₹${v.balanceDue}`);
  if (v.receiptNumber && v.receiptUrl) {
    payment.push(`*Receipt No:* ${v.receiptNumber}`);
  }
  if (payment.length > 0) lines.push('', ...payment);

  if (v.receiptUrl) {
    lines.push('', '*Download your receipt (PDF):*', v.receiptUrl);
  }

  lines.push(
    '',
    'Please mention your Member ID at the front desk when you check in.',
    '',
    ...signOff(v, callUs(v.gymPhone)),
  );

  return lines.join('\n');
}

export interface ReceiptChatVariables extends Signature {
  name: string;
  amount: string;
  paymentMode: string;
  paidOn: string;
  receiptNumber: string;
  receiptUrl: string;
  /** Only when something is still owed. */
  balanceDue?: string;
  /** The membership the payment was for, when it was for one. */
  plan?: string;
  validUntil?: string;
}

export function receiptChatMessage(v: ReceiptChatVariables): string {
  const lines = [
    ...letterhead(v.gymName, 'Payment Receipt'),
    `Dear ${v.name},`,
    '',
    'Thank you for your payment. Here are the details for your records.',
    '',
    `*Receipt No:* ${v.receiptNumber}`,
    `*Date:* ${v.paidOn}`,
    `*Payment Mode:* ${v.paymentMode}`,
    `*Amount Paid:* ₹${v.amount}`,
    v.balanceDue
      ? `*Balance Due:* ₹${v.balanceDue}`
      : '*Balance Due:* Nil',
  ];

  if (v.balanceDue) {
    lines.push('_Kindly clear the balance at the front desk on your next visit._');
  }

  if (v.plan) {
    lines.push('', `*Plan:* ${v.plan}`);
    if (v.validUntil) lines.push(`*Valid Till:* ${v.validUntil}`);
  }

  lines.push(
    '',
    '*Download your receipt (PDF):*',
    v.receiptUrl,
    '',
    ...signOff(v, callUs(v.gymPhone)),
  );

  return lines.join('\n');
}

export interface RenewalChatVariables extends Signature {
  /** First name. */
  name: string;
  memberId: string;
  plan: string;
  validFrom: string;
  validUntil: string;
  /** "4,500" — omitted when nothing was paid (a fully discounted renewal). */
  amountPaid?: string;
  paymentMode?: string;
  receiptNumber?: string;
  receiptUrl?: string;
}

export function renewalChatMessage(v: RenewalChatVariables): string {
  const lines = [
    ...letterhead(v.gymName, 'Membership Renewal'),
    `Dear ${v.name},`,
    '',
    `Thank you for renewing your membership with *${v.gymName}*. Here are your new membership details.`,
    '',
    `*Member ID:* ${v.memberId}`,
    `*Plan:* ${v.plan}`,
    `*Start Date:* ${v.validFrom}`,
    `*Valid Till:* ${v.validUntil}`,
  ];

  const payment: string[] = [];
  if (v.amountPaid) {
    payment.push(
      `*Amount Paid:* ₹${v.amountPaid}${v.paymentMode ? ` (${v.paymentMode})` : ''}`,
    );
  }
  if (v.receiptNumber && v.receiptUrl) {
    payment.push(`*Receipt No:* ${v.receiptNumber}`);
  }
  if (payment.length > 0) lines.push('', ...payment);

  if (v.receiptUrl) {
    lines.push('', '*Download your receipt (PDF):*', v.receiptUrl);
  }

  lines.push(
    '',
    'We look forward to seeing you at the gym.',
    '',
    ...signOff(v, callUs(v.gymPhone)),
  );

  return lines.join('\n');
}

export interface ReminderChatVariables extends Signature {
  kind: 'EXPIRY_REMINDER' | 'PAYMENT_DUE';
  name: string;
  memberId: string;
  /** The member's latest plan, shown on expiry reminders. */
  plan?: string;
  /** For EXPIRY_REMINDER. */
  expiryDate?: string;
  /** The date has already passed: "expired on", not "expires on". */
  expired?: boolean;
  /** For PAYMENT_DUE. */
  balanceDue?: string;
}

export function reminderChatMessage(v: ReminderChatVariables): string {
  if (v.kind === 'EXPIRY_REMINDER') {
    const facts = [`*Member ID:* ${v.memberId}`];
    if (v.plan) facts.push(`*Plan:* ${v.plan}`);
    facts.push(
      v.expired
        ? `*Expired On:* ${v.expiryDate}`
        : `*Expires On:* ${v.expiryDate}`,
    );

    return [
      ...letterhead(v.gymName, 'Membership Renewal Reminder'),
      `Dear ${v.name},`,
      '',
      v.expired
        ? `Your *${v.gymName}* membership has expired. We miss you at the gym!`
        : `This is a friendly reminder that your *${v.gymName}* membership is due for renewal.`,
      '',
      ...facts,
      '',
      v.expired
        ? 'Renew today to get back to your training.'
        : 'Renew before the expiry date to keep training without a break.',
      '',
      ...signOff(
        v,
        v.gymPhone
          ? `To renew, call us on ${v.gymPhone} or simply reply to this message.`
          : 'To renew, simply reply to this message.',
      ),
    ].join('\n');
  }

  return [
    ...letterhead(v.gymName, 'Payment Reminder'),
    `Dear ${v.name},`,
    '',
    `This is a gentle reminder that a balance is pending on your *${v.gymName}* membership.`,
    '',
    `*Member ID:* ${v.memberId}`,
    `*Balance Due:* ₹${v.balanceDue}`,
    '',
    'Kindly clear it at the front desk on your next visit. Thank you for your prompt attention.',
    '',
    ...signOff(
      v,
      v.gymPhone
        ? `For any questions, call us on ${v.gymPhone} or reply to this message.`
        : 'For any questions, simply reply to this message.',
    ),
  ].join('\n');
}

/**
 * "Praneeth" for the greeting, from a full name. Names are typed at the desk
 * as "praneeth" or imported as "PRANEETH", and "Dear praneeth," reads
 * careless; a name typed in mixed case ("McKenzie") is left as it is.
 */
export function greetingName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? fullName;
  const oneCase = first === first.toLowerCase() || first === first.toUpperCase();
  return oneCase
    ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase()
    : first;
}

/** The number as WhatsApp links want it: country code, digits only. */
export function whatsAppPhone(phone: string): string {
  return toE164(phone).slice(1);
}
