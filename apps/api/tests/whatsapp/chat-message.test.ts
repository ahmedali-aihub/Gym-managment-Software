import {
  greetingName,
  receiptChatMessage,
  reminderChatMessage,
  welcomeChatMessage,
  whatsAppPhone,
} from '@azf/shared';
import { describe, expect, it } from 'vitest';

/**
 * The messages the desk sends from its own WhatsApp. Lines that do not apply
 * must vanish, not print as "Paid: ₹" or "Call us on undefined".
 */
const signature = { gymName: 'A to Z Fitness', gymLocation: 'Mehdipatnam, Hyderabad' };

describe('every message', () => {
  const messages = [
    welcomeChatMessage({
      ...signature,
      name: 'Rahul',
      memberId: '6374',
      plan: 'Monthly',
      validFrom: '22 Oct 2026',
      validUntil: '20 Nov 2026',
    }),
    receiptChatMessage({
      ...signature,
      name: 'Rahul',
      amount: '500',
      paymentMode: 'Cash',
      paidOn: '22 Oct 2026',
      receiptNumber: 'RCPT/2026-27/0036',
      receiptUrl: 'https://example.com/api/r/abc.def',
    }),
    reminderChatMessage({ ...signature, kind: 'EXPIRY_REMINDER', name: 'Rahul', memberId: '6374', expiryDate: '20 Nov 2026' }),
    reminderChatMessage({ ...signature, kind: 'PAYMENT_DUE', name: 'Rahul', memberId: '6374', balanceDue: '1,000' }),
  ];

  it('opens with the letterhead and a formal greeting', () => {
    for (const text of messages) {
      expect(text.startsWith('*A TO Z FITNESS*\n_')).toBe(true);
      expect(text).toContain('━━━━━━━━━━━━━━━━');
      expect(text).toContain('Dear Rahul,');
    }
  });

  it('signs off from the team with the location', () => {
    for (const text of messages) {
      expect(text.endsWith('Warm regards,\n*Team A to Z Fitness*\nMehdipatnam, Hyderabad')).toBe(true);
    }
  });

  it('contains no emoji', () => {
    for (const text of messages) expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('never prints a missing value', () => {
    for (const text of messages) expect(text).not.toMatch(/undefined|null|₹\s*$/m);
  });
});

describe('welcomeChatMessage', () => {
  const base = {
    ...signature,
    name: 'Rahul',
    memberId: '6374',
    plan: 'Monthly',
    validFrom: '22 Oct 2026',
    validUntil: '20 Nov 2026',
  };

  it('includes payment, receipt link and phone when there are some', () => {
    const text = welcomeChatMessage({
      ...base,
      amountPaid: '1,500',
      paymentMode: 'UPI',
      receiptNumber: 'RCPT/2026-27/0035',
      receiptUrl: 'https://example.com/api/r/abc.def',
      gymPhone: '+91 98765 43210',
    });

    expect(text).toContain('_Membership Confirmation_');
    expect(text).toContain('*Member ID:* 6374');
    expect(text).toContain('*Valid Till:* 20 Nov 2026');
    expect(text).toContain('*Amount Paid:* ₹1,500 (UPI)');
    expect(text).toContain('*Receipt No:* RCPT/2026-27/0035');
    expect(text).toContain('*Download your receipt (PDF):*\nhttps://example.com/api/r/abc.def');
    expect(text).toContain('For any assistance, call us on +91 98765 43210.');
    expect(text).not.toContain('Balance Due');
  });

  it('drops the payment, receipt and phone lines for a pay-later member', () => {
    const text = welcomeChatMessage({ ...base, balanceDue: '1,500' });

    expect(text).toContain('*Balance Due:* ₹1,500');
    expect(text).not.toMatch(/Amount Paid|Receipt|call us/i);
  });
});

describe('receiptChatMessage', () => {
  const base = {
    ...signature,
    name: 'Rahul',
    amount: '500',
    paymentMode: 'Cash',
    paidOn: '22 Oct 2026',
    receiptNumber: 'RCPT/2026-27/0036',
    receiptUrl: 'https://example.com/api/r/abc.def',
  };

  it('lists the payment and says nothing is due when the member is settled', () => {
    const text = receiptChatMessage(base);
    expect(text).toContain('_Payment Receipt_');
    expect(text).toContain('*Receipt No:* RCPT/2026-27/0036');
    expect(text).toContain('*Date:* 22 Oct 2026');
    expect(text).toContain('*Payment Mode:* Cash');
    expect(text).toContain('*Amount Paid:* ₹500');
    expect(text).toContain('*Balance Due:* Nil');
    expect(text).toContain('*Download your receipt (PDF):*\nhttps://example.com/api/r/abc.def');
    expect(text).not.toContain('Kindly clear');
  });

  it('shows the balance, and asks for it, when something is still owed', () => {
    const text = receiptChatMessage({ ...base, balanceDue: '1,000' });
    expect(text).toContain('*Balance Due:* ₹1,000');
    expect(text).toContain('Kindly clear the balance');
    expect(text).not.toContain('Nil');
  });

  it('names the plan and validity only when the payment was for a membership', () => {
    const withPlan = receiptChatMessage({ ...base, plan: 'FITNESS 1M', validUntil: '21 Nov 2026' });
    expect(withPlan).toContain('*Plan:* FITNESS 1M\n*Valid Till:* 21 Nov 2026');

    expect(receiptChatMessage(base)).not.toMatch(/Plan:|Valid Till/);
  });
});

describe('reminderChatMessage', () => {
  const base = { ...signature, name: 'Rahul', memberId: '6374' };

  it('expiry reminder: "expires on" while there is time left', () => {
    const text = reminderChatMessage({ ...base, kind: 'EXPIRY_REMINDER', plan: 'Monthly', expiryDate: '20 Nov 2026' });
    expect(text).toContain('_Membership Renewal Reminder_');
    expect(text).toContain('*Plan:* Monthly');
    expect(text).toContain('*Expires On:* 20 Nov 2026');
    expect(text).toContain('Renew before the expiry date');
  });

  it('expiry reminder: "expired on" once the date has passed', () => {
    const text = reminderChatMessage({ ...base, kind: 'EXPIRY_REMINDER', expiryDate: '01 Oct 2026', expired: true });
    expect(text).toContain('*Expired On:* 01 Oct 2026');
    expect(text).toContain('has expired');
    expect(text).not.toContain('Expires On');
  });

  it('dues reminder shows the balance, and the phone only when set', () => {
    const withPhone = reminderChatMessage({ ...base, kind: 'PAYMENT_DUE', balanceDue: '1,000', gymPhone: '+91 98765 43210' });
    expect(withPhone).toContain('_Payment Reminder_');
    expect(withPhone).toContain('*Balance Due:* ₹1,000');
    expect(withPhone).toContain('call us on +91 98765 43210');

    const withoutPhone = reminderChatMessage({ ...base, kind: 'PAYMENT_DUE', balanceDue: '1,000' });
    expect(withoutPhone).not.toMatch(/call us|undefined/i);
    expect(withoutPhone).toContain('simply reply to this message');
  });
});

describe('greetingName', () => {
  it('capitalises a first name typed in one case', () => {
    expect(greetingName('praneeth kumar')).toBe('Praneeth');
    expect(greetingName('  AHMED ALI ')).toBe('Ahmed');
  });

  it('keeps a name typed in mixed case as it is', () => {
    expect(greetingName('McKenzie Rao')).toBe('McKenzie');
    expect(greetingName('Rahul')).toBe('Rahul');
  });
});

describe('whatsAppPhone', () => {
  it('gives country code and digits, whatever the input format', () => {
    expect(whatsAppPhone('98765 43210')).toBe('919876543210');
    expect(whatsAppPhone('+91 98765-43210')).toBe('919876543210');
    expect(whatsAppPhone('09876543210')).toBe('919876543210');
  });
});
