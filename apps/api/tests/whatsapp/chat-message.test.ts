import {
  receiptChatMessage,
  welcomeChatMessage,
  whatsAppPhone,
} from '@azf/shared';
import { describe, expect, it } from 'vitest';

/**
 * The messages the desk sends from its own WhatsApp. Lines that do not apply
 * must vanish, not print as "Paid: ₹" or "Call us on undefined".
 */
describe('welcomeChatMessage', () => {
  const base = {
    name: 'Rahul',
    gymName: 'A to Z Fitness',
    memberId: '6374',
    plan: 'Monthly',
    validFrom: '22/10/2026',
    validUntil: '20/11/2026',
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

    expect(text).toContain('Welcome to *A to Z Fitness*');
    expect(text).toContain('*Member ID:* 6374');
    expect(text).toContain('*Paid:* ₹1,500 (UPI)');
    expect(text).toContain('Your receipt RCPT/2026-27/0035:\nhttps://example.com/api/r/abc.def');
    expect(text).toContain('Call us on +91 98765 43210');
    expect(text).not.toContain('Balance due');
  });

  it('drops the payment, receipt and phone lines for a pay-later member', () => {
    const text = welcomeChatMessage({ ...base, balanceDue: '1,500' });

    expect(text).toContain('*Balance due:* ₹1,500');
    expect(text).not.toMatch(/Paid:|receipt|Call us|undefined/i);
    expect(text.endsWith('See you at the gym! 💪')).toBe(true);
  });
});

describe('receiptChatMessage', () => {
  const base = {
    name: 'Rahul',
    gymName: 'A to Z Fitness',
    amount: '500',
    paymentMode: 'Cash',
    paidOn: '22/10/2026',
    receiptNumber: 'RCPT/2026-27/0036',
    receiptUrl: 'https://example.com/api/r/abc.def',
  };

  it('says nothing is due when the member is settled', () => {
    const text = receiptChatMessage(base);
    expect(text).toContain('✅ Nothing is due.');
    expect(text).toContain('Download your receipt:\nhttps://example.com/api/r/abc.def');
  });

  it('shows the balance when something is still owed', () => {
    const text = receiptChatMessage({ ...base, balanceDue: '1,000' });
    expect(text).toContain('*Balance due:* ₹1,000');
    expect(text).not.toContain('Nothing is due');
  });
});

describe('whatsAppPhone', () => {
  it('gives country code and digits, whatever the input format', () => {
    expect(whatsAppPhone('98765 43210')).toBe('919876543210');
    expect(whatsAppPhone('+91 98765-43210')).toBe('919876543210');
    expect(whatsAppPhone('09876543210')).toBe('919876543210');
  });
});
