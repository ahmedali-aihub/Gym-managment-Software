import {
  PAYMENT_MODE_LABELS,
  daysUntil,
  formatDateLong,
  greetingName,
  paiseToRupees,
  receiptChatMessage,
  reminderChatMessage,
  renewalChatMessage,
  welcomeChatMessage,
  whatsAppPhone,
} from '@azf/shared';
import { gymConfig } from '../../config/env.js';
import { NotFoundError } from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { receiptUrl } from '../../lib/receipt-link.js';
import { paymentsService } from '../../modules/payments/payments.service.js';

const log = moduleLogger('whatsapp:chat');

/** A message ready for the desk to send from its own WhatsApp. */
export interface ChatMessage {
  /** 91XXXXXXXXXX — the form WhatsApp's click-to-chat links take. */
  phone: string;
  text: string;
}

const rupees = (paise: number) => paiseToRupees(paise).toLocaleString('en-IN');

/**
 * The gym's number for "call us" lines — or nothing while GYM_PHONE is still
 * the +91 00000 00000 placeholder, which no member should be told to call.
 */
function gymPhone(): string | undefined {
  const local = gymConfig.phone.replace(/^\s*\+?\s*91/, '');
  return /[1-9]/.test(local) ? gymConfig.phone : undefined;
}

/**
 * "Mehdipatnam, Hyderabad" for the sign-off: the locality and the city,
 * without the state and PIN that the second address line also carries.
 */
function gymLocation(): string | undefined {
  const city = gymConfig.addressLine2.split(',')[0]?.trim();
  return [gymConfig.addressLine1.trim(), city].filter(Boolean).join(', ') || undefined;
}

/** What every message signs off with. */
const signature = () => ({
  gymName: gymConfig.name,
  gymLocation: gymLocation(),
  gymPhone: gymPhone(),
});

/**
 * Builds the click-to-send WhatsApp messages from the records, so the text
 * always matches what the receipt and the profile say.
 */
class ChatMessageService {
  /**
   * Welcome for the member's latest membership, with the receipt of the
   * payment that opened it. Sent right after registration, and available
   * again from the profile.
   */
  async welcome(memberDbId: string): Promise<ChatMessage> {
    const member = await prisma.member.findFirst({
      where: { id: memberDbId, deletedAt: null },
      select: {
        id: true,
        memberId: true,
        fullName: true,
        phone: true,
        memberships: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            startDate: true,
            endDate: true,
            plan: { select: { name: true } },
            payments: {
              where: { deletedAt: null },
              orderBy: { paidAt: 'asc' },
              take: 1,
              select: {
                amountPaise: true,
                mode: true,
                invoice: { select: { id: true, invoiceNumber: true } },
              },
            },
          },
        },
      },
    });
    if (!member) throw new NotFoundError('Member');

    const membership = member.memberships[0];
    if (!membership) throw new NotFoundError('Membership');

    const opening = membership.payments[0];
    const balance = await paymentsService.getMemberBalance(member.id);

    return {
      phone: whatsAppPhone(member.phone),
      text: welcomeChatMessage({
        ...signature(),
        name: greetingName(member.fullName),
        memberId: member.memberId,
        plan: membership.plan.name,
        validFrom: formatDateLong(membership.startDate),
        validUntil: formatDateLong(membership.endDate),
        amountPaid: opening ? rupees(opening.amountPaise) : undefined,
        paymentMode: opening ? PAYMENT_MODE_LABELS[opening.mode] : undefined,
        balanceDue:
          balance.balanceDuePaise > 0 ? rupees(balance.balanceDuePaise) : undefined,
        receiptNumber: opening?.invoice?.invoiceNumber,
        receiptUrl: opening?.invoice ? receiptUrl(opening.invoice.id) : undefined,
      }),
    };
  }

  /**
   * Confirmation of a renewal: the new period, and the receipt of the
   * payment taken with it, if any.
   */
  async renewal(membershipId: string): Promise<ChatMessage> {
    const membership = await prisma.membership.findUnique({
      where: { id: membershipId },
      select: {
        startDate: true,
        endDate: true,
        plan: { select: { name: true } },
        member: { select: { memberId: true, fullName: true, phone: true } },
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'asc' },
          take: 1,
          select: {
            amountPaise: true,
            mode: true,
            invoice: { select: { id: true, invoiceNumber: true } },
          },
        },
      },
    });
    if (!membership) throw new NotFoundError('Membership');

    const payment = membership.payments[0];

    return {
      phone: whatsAppPhone(membership.member.phone),
      text: renewalChatMessage({
        ...signature(),
        name: greetingName(membership.member.fullName),
        memberId: membership.member.memberId,
        plan: membership.plan.name,
        validFrom: formatDateLong(membership.startDate),
        validUntil: formatDateLong(membership.endDate),
        amountPaid: payment ? rupees(payment.amountPaise) : undefined,
        paymentMode: payment ? PAYMENT_MODE_LABELS[payment.mode] : undefined,
        receiptNumber: payment?.invoice?.invoiceNumber,
        receiptUrl: payment?.invoice ? receiptUrl(payment.invoice.id) : undefined,
      }),
    };
  }

  /** Thank-you with the receipt link, for any payment that has a receipt. */
  async receipt(invoiceId: string): Promise<ChatMessage> {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        payment: {
          select: {
            amountPaise: true,
            mode: true,
            paidAt: true,
            // What the payment was for, so the receipt can say until when.
            membership: {
              select: { endDate: true, plan: { select: { name: true } } },
            },
          },
        },
        member: { select: { id: true, fullName: true, phone: true } },
      },
    });
    if (!invoice?.payment) throw new NotFoundError('Receipt');

    const balance = await paymentsService.getMemberBalance(invoice.member.id);
    const membership = invoice.payment.membership;

    return {
      phone: whatsAppPhone(invoice.member.phone),
      text: receiptChatMessage({
        ...signature(),
        name: greetingName(invoice.member.fullName),
        amount: rupees(invoice.payment.amountPaise),
        paymentMode: PAYMENT_MODE_LABELS[invoice.payment.mode],
        paidOn: formatDateLong(invoice.payment.paidAt),
        receiptNumber: invoice.invoiceNumber,
        receiptUrl: receiptUrl(invoice.id),
        balanceDue:
          balance.balanceDuePaise > 0 ? rupees(balance.balanceDuePaise) : undefined,
        plan: membership?.plan.name,
        validUntil: membership ? formatDateLong(membership.endDate) : undefined,
      }),
    };
  }

  /** An expiry or dues reminder, from the member's current state. */
  async reminder(
    memberDbId: string,
    kind: 'EXPIRY_REMINDER' | 'PAYMENT_DUE',
  ): Promise<ChatMessage> {
    const member = await prisma.member.findFirst({
      where: { id: memberDbId, deletedAt: null },
      select: {
        id: true,
        memberId: true,
        fullName: true,
        phone: true,
        memberships: {
          orderBy: { endDate: 'desc' },
          take: 1,
          select: { endDate: true, plan: { select: { name: true } } },
        },
      },
    });
    if (!member) throw new NotFoundError('Member');

    const latest = member.memberships[0];
    const endDate = latest?.endDate;
    const balance = await paymentsService.getMemberBalance(member.id);

    return {
      phone: whatsAppPhone(member.phone),
      text: reminderChatMessage({
        ...signature(),
        kind,
        name: greetingName(member.fullName),
        memberId: member.memberId,
        plan: latest?.plan.name,
        expiryDate: endDate ? formatDateLong(endDate) : '—',
        expired: endDate ? daysUntil(endDate) < 0 : false,
        balanceDue: rupees(balance.balanceDuePaise),
      }),
    };
  }

  /** The receipt message for a payment, found by the payment rather than its receipt. */
  async receiptForPayment(paymentId: string): Promise<ChatMessage> {
    const invoice = await prisma.invoice.findUnique({
      where: { paymentId },
      select: { id: true },
    });
    if (!invoice) throw new NotFoundError('Receipt');
    return this.receipt(invoice.id);
  }
}

export const chatMessageService = new ChatMessageService();

/**
 * For responses that offer the message as a convenience — a registration
 * or payment that has already succeeded must not fail because its WhatsApp
 * text could not be built. The failure is logged and the message is null.
 */
export async function chatMessageOrNull(
  build: Promise<ChatMessage>,
  context: Record<string, unknown>,
): Promise<ChatMessage | null> {
  try {
    return await build;
  } catch (error) {
    log.warn({ err: error, ...context }, 'WhatsApp chat message unavailable');
    return null;
  }
}
