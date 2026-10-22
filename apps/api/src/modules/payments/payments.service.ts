import type {
  MemberBalance,
  PaginatedResponse,
  PaymentQuery,
  PaymentStats,
  RecordPaymentPayload,
  RefundPaymentInput,
} from '@azf/shared';
import {
  EmailTemplateKey,
  PAYMENT_MODE_LABELS,
  PaymentMode,
  PaymentStatus,
  SmsTemplateKey,
  WhatsAppTemplateKey,
  formatDate,
  paiseToRupees,
} from '@azf/shared';
import type { Payment, Prisma } from '@prisma/client';
import { issueReceipt } from '../invoices/receipt-issuer.js';
import { emailService } from '../../services/email/email.service.js';
import { whatsappService } from '../../services/whatsapp/whatsapp.service.js';
import { runInBackground } from '../../lib/background.js';
import {
  InvalidStateError,
  NotFoundError,
  PaymentError,
} from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import {
  buildOrderBy,
  buildPaginatedResponse,
  getSkipTake,
} from '../../lib/pagination.js';
import { prisma, TRANSACTION_OPTIONS } from '../../lib/prisma.js';
import { smsService } from '../../services/sms/sms.service.js';
import { calculateBalance, derivePaymentStatus } from './billing.js';
import { getDuesSummary } from './dues.js';

const log = moduleLogger('payments');

const SORTABLE_FIELDS = ['paidAt', 'amountPaise', 'createdAt', 'mode'] as const;

class PaymentsService {
  /**
   * Record a payment.
   *
   * Three protections matter here, and all three are server-side:
   *
   *  1. The outstanding balance is recomputed from the database. The client
   *     never tells us what is owed.
   *  2. Overpayment is rejected. Taking more than is due is a data-entry
   *     error, and silently accepting it corrupts the dues figure the owner
   *     relies on.
   *  3. `idempotencyKey` is unique-constrained, so a double-click at a busy
   *     front desk cannot create two receipts for one handover of cash.
   */
  async record(
    input: RecordPaymentPayload,
    collectedById: string | null,
  ): Promise<{ payment: Payment; balance: MemberBalance }> {
    if (input.idempotencyKey) {
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });

      // Return the original rather than erroring: from the caller's point of
      // view the payment succeeded, which is true — it just already happened.
      if (existing) {
        log.info(
          { paymentId: existing.id },
          'Duplicate payment suppressed by idempotency key',
        );
        return {
          payment: existing,
          balance: await this.getMemberBalance(existing.memberId),
        };
      }
    }

    const member = await prisma.member.findFirst({
      where: { id: input.memberId, deletedAt: null },
    });
    if (!member) throw new NotFoundError('Member');

    const balanceBefore = await this.getMemberBalance(input.memberId);

    if (balanceBefore.balanceDuePaise === 0) {
      throw new PaymentError(
        'This member has no outstanding balance',
        'PAYMENT_EXCEEDS_DUE',
      );
    }

    if (input.amountPaise > balanceBefore.balanceDuePaise) {
      throw new PaymentError(
        `Amount exceeds the outstanding balance of ₹${paiseToRupees(
          balanceBefore.balanceDuePaise,
        ).toLocaleString('en-IN')}`,
        'PAYMENT_EXCEEDS_DUE',
      );
    }

    // Default to the membership this payment most plausibly settles.
    let membershipId = input.membershipId ?? null;
    if (!membershipId) {
      const active = await prisma.membership.findFirst({
        where: { memberId: input.memberId, status: { in: ['ACTIVE', 'FROZEN'] } },
        orderBy: { endDate: 'desc' },
      });
      membershipId = active?.id ?? null;
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          memberId: input.memberId,
          membershipId,
          amountPaise: input.amountPaise,
          discountPaise: input.discountAmount,
          discountReason: input.discountReason ?? null,
          mode: input.mode,
          status: PaymentStatus.PAID,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          paidAt: input.paidAt,
          idempotencyKey: input.idempotencyKey ?? null,
          collectedById,
        },
      });

      if (input.generateInvoice) {
        await issueReceipt(tx, created.id, input.memberId, membershipId);
      }

      return created;
    }, TRANSACTION_OPTIONS);

    const balance = await this.getMemberBalance(input.memberId);

    log.info(
      {
        paymentId: payment.id,
        memberId: member.memberId,
        amountPaise: payment.amountPaise,
        mode: payment.mode,
        balanceDuePaise: balance.balanceDuePaise,
      },
      'Payment recorded',
    );

    if (input.sendSms) {
      runInBackground(
        this.sendReceiptSms(member.id, member.phone, member.memberId, payment, balance),
        'receipt SMS',
      );
    }

    // WhatsApp confirmation — the channel most members read. Always sent,
    // because every member has a mobile number.
    runInBackground(
      this.sendReceiptWhatsApp(
        member.id,
        member.phone,
        member.fullName,
        member.memberId,
        payment,
        balance,
      ),
      'receipt WhatsApp',
    );

    // The receipt PDF, emailed to the member. Sent whenever they gave an
    // address and with no per-payment toggle: email costs nothing, needs no
    // DLT approval, and a member who has paid should not have to ask for
    // proof of it.
    if (member.email) {
      runInBackground(
        this.sendReceiptEmail(
          member.id,
          member.email,
          member.fullName,
          member.memberId,
          payment,
          balance,
        ),
        'receipt email',
      );
    }

    return { payment, balance };
  }

  private async sendReceiptWhatsApp(
    memberDbId: string,
    phone: string,
    fullName: string,
    memberCode: string,
    payment: Payment,
    balance: MemberBalance,
  ): Promise<void> {
    try {
      const invoice = await prisma.invoice.findFirst({
        where: { paymentId: payment.id },
        select: { invoiceNumber: true },
      });

      await whatsappService.send({
        to: phone,
        templateKey: WhatsAppTemplateKey.PAYMENT_RECEIPT,
        memberId: memberDbId,
        variables: {
          name: fullName.split(' ')[0] ?? fullName,
          amount: paiseToRupees(payment.amountPaise).toLocaleString('en-IN'),
          paidDate: formatDate(payment.paidAt),
          mode: PAYMENT_MODE_LABELS[payment.mode] ?? payment.mode,
          receiptNo: invoice?.invoiceNumber ?? memberCode,
          balance: paiseToRupees(balance.balanceDuePaise).toLocaleString('en-IN'),
        },
      });
    } catch (error) {
      // Never throws: the payment is already taken and recorded.
      log.error(
        { err: error, paymentId: payment.id },
        'Receipt WhatsApp failed to queue',
      );
    }
  }

  private async sendReceiptEmail(
    memberDbId: string,
    email: string,
    fullName: string,
    memberCode: string,
    payment: Payment,
    balance: MemberBalance,
  ): Promise<void> {
    try {
      // The invoice raised inside the payment transaction above. Looked up
      // by paymentId rather than "most recent for this member", which would
      // attach the wrong document when two payments land together.
      const invoice = await prisma.invoice.findFirst({
        where: { paymentId: payment.id },
        select: { id: true, invoiceNumber: true },
      });

      await emailService.send({
        to: email,
        templateKey: EmailTemplateKey.RECEIPT,
        memberId: memberDbId,
        attachInvoiceId: invoice?.id,
        variables: {
          name: fullName,
          memberId: memberCode,
          receiptNo: invoice?.invoiceNumber ?? '—',
          paidDate: formatDate(payment.paidAt),
          mode: PAYMENT_MODE_LABELS[payment.mode] ?? payment.mode,
          amount: paiseToRupees(payment.amountPaise).toLocaleString('en-IN'),
          balance: paiseToRupees(balance.balanceDuePaise).toLocaleString('en-IN'),
        },
      });
    } catch (error) {
      // Never throws: a mail outage must not fail a payment that has
      // already been taken and recorded.
      log.error(
        { err: error, paymentId: payment.id },
        'Receipt email failed to queue',
      );
    }
  }

  private async sendReceiptSms(
    memberDbId: string,
    phone: string,
    memberCode: string,
    payment: Payment,
    balance: MemberBalance,
  ): Promise<void> {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { paymentId: payment.id },
        select: { invoiceNumber: true },
      });

      await smsService.send({
        to: phone,
        templateKey: SmsTemplateKey.PAYMENT_RECEIPT,
        memberId: memberDbId,
        variables: {
          amount: paiseToRupees(payment.amountPaise).toLocaleString('en-IN'),
          date: formatDate(payment.paidAt),
          memberId: memberCode,
          balance: paiseToRupees(balance.balanceDuePaise).toLocaleString('en-IN'),
          receiptNo: invoice?.invoiceNumber ?? '-',
        },
      });
    } catch (error) {
      log.error({ err: error, paymentId: payment.id }, 'Receipt SMS failed');
    }
  }

  /**
   * A member's money position, computed from the source rows rather than a
   * cached column — so it cannot drift out of sync with reality.
   */
  async getMemberBalance(memberId: string): Promise<MemberBalance> {
    const [billed, paid, lastPayment] = await Promise.all([
      prisma.membership.aggregate({
        where: { memberId },
        _sum: { totalPaise: true, discountPaise: true },
      }),
      prisma.payment.aggregate({
        where: { memberId, deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
      prisma.payment.findFirst({
        where: { memberId, deletedAt: null },
        orderBy: { paidAt: 'desc' },
        select: { paidAt: true },
      }),
    ]);

    const totalBilledPaise = billed._sum.totalPaise ?? 0;
    const totalPaidPaise = paid._sum.amountPaise ?? 0;
    const totalRefundedPaise = paid._sum.refundedPaise ?? 0;

    return {
      totalBilledPaise,
      totalPaidPaise,
      totalDiscountPaise: billed._sum.discountPaise ?? 0,
      totalRefundedPaise,
      balanceDuePaise: calculateBalance({
        totalBilledPaise,
        totalPaidPaise,
        totalRefundedPaise,
      }),
      lastPaymentAt: lastPayment?.paidAt.toISOString() ?? null,
      status: derivePaymentStatus({
        totalBilledPaise,
        totalPaidPaise,
        totalRefundedPaise,
      }) as MemberBalance['status'],
    };
  }

  async list(params: PaymentQuery): Promise<PaginatedResponse<unknown>> {
    const { skip, take } = getSkipTake(params);

    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      ...(params.memberId ? { memberId: params.memberId } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.from || params.to
        ? {
            paidAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
      ...(params.minAmount !== undefined || params.maxAmount !== undefined
        ? {
            amountPaise: {
              ...(params.minAmount !== undefined ? { gte: params.minAmount } : {}),
              ...(params.maxAmount !== undefined ? { lte: params.maxAmount } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { reference: { contains: params.search, mode: 'insensitive' } },
              {
                member: {
                  OR: [
                    { fullName: { contains: params.search, mode: 'insensitive' } },
                    { memberId: { contains: params.search, mode: 'insensitive' } },
                    { phone: { contains: params.search.replace(/\D/g, '') } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take,
        include: {
          member: {
            select: { id: true, memberId: true, fullName: true, phone: true },
          },
          invoice: { select: { id: true, invoiceNumber: true, pdfUrl: true } },
          collectedBy: { select: { id: true, fullName: true } },
        },
        orderBy: buildOrderBy(
          params.sortBy,
          params.sortOrder,
          SORTABLE_FIELDS,
          'paidAt',
        ),
      }),
      prisma.payment.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, params);
  }

  /** Totals for the payments list header and revenue KPIs. */
  async getStats(from?: Date, to?: Date): Promise<PaymentStats> {
    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      ...(from || to
        ? {
            paidAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const [totals, byMode, dues] = await Promise.all([
      prisma.payment.aggregate({
        where,
        _sum: { amountPaise: true, refundedPaise: true, discountPaise: true },
        _count: { _all: true },
      }),
      prisma.payment.groupBy({
        by: ['mode'],
        where,
        _sum: { amountPaise: true },
        _count: { _all: true },
      }),
      getDuesSummary(),
    ]);

    const modeMap = Object.fromEntries(
      Object.values(PaymentMode).map((mode) => [
        mode,
        { count: 0, amountPaise: 0 },
      ]),
    ) as PaymentStats['byMode'];

    for (const row of byMode) {
      modeMap[row.mode] = {
        count: row._count._all,
        amountPaise: row._sum.amountPaise ?? 0,
      };
    }

    const collectedPaise = totals._sum.amountPaise ?? 0;

    return {
      collectedPaise,
      // What members owe right now, whatever the date range: subtracting
      // only the range's payments from all-time billing gave a figure that
      // meant nothing whenever a range was set.
      pendingPaise: dues.totalPaise,
      refundedPaise: totals._sum.refundedPaise ?? 0,
      discountPaise: totals._sum.discountPaise ?? 0,
      transactionCount: totals._count._all,
      byMode: modeMap,
    };
  }

  async getById(id: string) {
    const payment = await prisma.payment.findFirst({
      where: { id, deletedAt: null },
      include: {
        member: true,
        membership: { include: { plan: true } },
        invoice: true,
        collectedBy: { select: { id: true, fullName: true } },
      },
    });

    if (!payment) throw new NotFoundError('Payment');
    return payment;
  }

  /**
   * Refund a payment, fully or partially.
   *
   * The refund is recorded on the original row rather than as a negative
   * payment: it keeps "how much was collected" and "how much was given back"
   * as separate figures, which is what reconciliation and the P&L both need.
   */
  async refund(
    input: RefundPaymentInput,
    actorId: string | null,
  ): Promise<Payment> {
    const payment = await prisma.payment.findFirst({
      where: { id: input.paymentId, deletedAt: null },
    });
    if (!payment) throw new NotFoundError('Payment');

    if (payment.status === PaymentStatus.FAILED) {
      throw new InvalidStateError('A failed payment cannot be refunded');
    }

    const alreadyRefunded = payment.refundedPaise;
    const refundable = payment.amountPaise - alreadyRefunded;

    if (refundable <= 0) {
      throw new InvalidStateError('This payment has already been fully refunded');
    }

    if (input.amountPaise > refundable) {
      throw new PaymentError(
        `Refund exceeds the refundable amount of ₹${paiseToRupees(
          refundable,
        ).toLocaleString('en-IN')}`,
      );
    }

    const totalRefunded = alreadyRefunded + input.amountPaise;

    const updated = await prisma.payment.update({
      where: { id: input.paymentId },
      data: {
        refundedPaise: totalRefunded,
        refundedAt: new Date(),
        refundReason: input.reason,
        status:
          totalRefunded === payment.amountPaise
            ? PaymentStatus.REFUNDED
            : payment.status,
      },
    });

    log.info(
      {
        paymentId: input.paymentId,
        refundedPaise: input.amountPaise,
        actorId,
      },
      'Payment refunded',
    );

    return updated;
  }

  /** Members with an outstanding balance — the dashboard's "top defaulters". */
  /**
   * Members with the largest outstanding balances.
   *
   * One aggregate query — billed minus paid plus refunded, the arithmetic of
   * calculateBalance — ranked and cut to `limit` inside the database. It
   * used to load every active and expired member with all their memberships
   * and payments (over 25,000 rows since the migration) and rank them in
   * JavaScript, on every dashboard load and again every minute the dashboard
   * stayed open.
   */
  async getDefaulters(limit = 10) {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        memberId: string;
        fullName: string;
        phone: string;
        photoUrl: string | null;
        balanceDuePaise: bigint | number | string;
      }>
    >`
      SELECT m.id, m."memberId", m."fullName", m.phone, m."photoUrl",
             COALESCE(b.billed, 0) - COALESCE(p.paid, 0) + COALESCE(p.refunded, 0)
               AS "balanceDuePaise"
      FROM members m
      LEFT JOIN (
        SELECT "memberId", SUM("totalPaise")::bigint AS billed
        FROM memberships
        GROUP BY "memberId"
      ) b ON b."memberId" = m.id
      LEFT JOIN (
        SELECT "memberId",
               SUM("amountPaise")::bigint AS paid,
               SUM("refundedPaise")::bigint AS refunded
        FROM payments
        WHERE "deletedAt" IS NULL
        GROUP BY "memberId"
      ) p ON p."memberId" = m.id
      WHERE m."deletedAt" IS NULL
        AND m.status IN ('ACTIVE', 'EXPIRED')
        AND COALESCE(b.billed, 0) - COALESCE(p.paid, 0) + COALESCE(p.refunded, 0) > 0
      ORDER BY "balanceDuePaise" DESC, m."memberId"
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      ...row,
      balanceDuePaise: Number(row.balanceDuePaise),
    }));
  }
}

export const paymentsService = new PaymentsService();
