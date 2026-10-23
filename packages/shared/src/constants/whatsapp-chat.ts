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
 * WhatsApp renders *text* as bold, which is what keeps these scannable on a
 * phone. Lines for values that do not apply are left out entirely rather
 * than shown blank.
 */

export interface WelcomeChatVariables {
  /** First name. */
  name: string;
  gymName: string;
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
  /** Left out while the gym phone is still the placeholder. */
  gymPhone?: string;
}

export function welcomeChatMessage(v: WelcomeChatVariables): string {
  const lines = [
    `Hi ${v.name}! 👋`,
    `Welcome to *${v.gymName}*. Your membership is now active.`,
    '',
    `*Member ID:* ${v.memberId}`,
    `*Plan:* ${v.plan}`,
    `*Valid:* ${v.validFrom} to ${v.validUntil}`,
  ];

  if (v.amountPaid) {
    lines.push(
      `*Paid:* ₹${v.amountPaid}${v.paymentMode ? ` (${v.paymentMode})` : ''}`,
    );
  }
  if (v.balanceDue) lines.push(`*Balance due:* ₹${v.balanceDue}`);

  if (v.receiptUrl) {
    lines.push(
      '',
      `🧾 Your receipt${v.receiptNumber ? ` ${v.receiptNumber}` : ''}:`,
      v.receiptUrl,
    );
  }

  lines.push('');
  if (v.gymPhone) lines.push(`Questions? Call us on ${v.gymPhone}.`);
  lines.push('See you at the gym! 💪');

  return lines.join('\n');
}

export interface ReceiptChatVariables {
  name: string;
  gymName: string;
  amount: string;
  paymentMode: string;
  paidOn: string;
  receiptNumber: string;
  receiptUrl: string;
  /** Only when something is still owed. */
  balanceDue?: string;
}

export function receiptChatMessage(v: ReceiptChatVariables): string {
  return [
    `Hi ${v.name}, thank you for your payment! 🙏`,
    '',
    `*Amount:* ₹${v.amount} (${v.paymentMode})`,
    `*Date:* ${v.paidOn}`,
    `*Receipt:* ${v.receiptNumber}`,
    v.balanceDue ? `*Balance due:* ₹${v.balanceDue}` : '✅ Nothing is due.',
    '',
    '🧾 Download your receipt:',
    v.receiptUrl,
    '',
    `— ${v.gymName}`,
  ].join('\n');
}

/** The number as WhatsApp links want it: country code, digits only. */
export function whatsAppPhone(phone: string): string {
  return toE164(phone).slice(1);
}
