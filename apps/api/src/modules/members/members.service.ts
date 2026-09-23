import type {
  CreateMemberPayload,
  MemberQuery,
  MemberStats,
  PaginatedResponse,
  UpdateMemberInput,
} from '@azf/shared';
import {
  EmailTemplateKey,
  MemberStatus,
  MembershipStatus,
  PaymentStatus,
  SmsTemplateKey,
  WhatsAppTemplateKey,
  calculateExpiryDate,
  formatDate,
  paiseToRupees,
} from '@azf/shared';
import type { Member, Prisma } from '@prisma/client';
import { gymConfig } from '../../config/env.js';
import { InvalidStateError, NotFoundError } from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import {
  buildOrderBy,
  buildPaginatedResponse,
  getSkipTake,
} from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { nextMemberId } from '../../lib/sequences.js';
import { generateQrDataUrl } from '../../services/qr/qr.service.js';
import {
  auditService,
  type AuditActor,
} from '../../services/audit/audit.service.js';
import { issueReceipt } from '../invoices/receipt-issuer.js';
import { emailService } from '../../services/email/email.service.js';
import { whatsappService } from '../../services/whatsapp/whatsapp.service.js';
import { smsService } from '../../services/sms/sms.service.js';
import {
  deletePhoto,
  savePhotoFromDataUrl,
} from '../../services/storage/photo.service.js';
import { calculateBalance, calculateBill } from '../payments/billing.js';

const log = moduleLogger('members');

const SORTABLE_FIELDS = [
  'fullName',
  'memberId',
  'joinedAt',
  'createdAt',
  'phone',
] as const;

/** Member with the relations the UI always needs alongside it. */
const memberInclude = {
  memberships: {
    // Not filtered by status: an expired member still needs their last
    // membership shown, or the list renders "—" for everyone who lapsed.
    orderBy: { endDate: 'desc' },
    take: 1,
    include: { plan: true },
  },
  trainer: { include: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.MemberInclude;

class MembersService {
  /**
   * Register a member.
   *
   * Everything happens in one transaction: allocate the member ID, create the
   * member, create their first membership, and record the opening payment. A
   * member row without a membership is not a state the front desk should ever
   * see, and a half-written registration is worse than a failed one.
   *
   * The welcome SMS is sent AFTER the transaction commits. Sending inside it
   * would hold a database transaction open across a network call to an SMS
   * gateway, and a gateway timeout would roll back a registration the member
   * already paid for.
   */
  async register(
    input: CreateMemberPayload,
    createdById: string | null,
    actor?: AuditActor,
  ): Promise<{ member: Member; qrDataUrl: string }> {
    const plan = await prisma.plan.findFirst({
      where: { id: input.planId, deletedAt: null },
    });
    if (!plan) throw new NotFoundError('Plan');
    if (!plan.isActive) {
      throw new InvalidStateError('That plan is no longer offered');
    }

    if (input.trainerId) {
      const trainer = await prisma.trainerProfile.findUnique({
        where: { id: input.trainerId },
      });
      if (!trainer) throw new NotFoundError('Trainer');
    }

    // Photo is written to disk before the transaction: file I/O inside a
    // transaction would hold locks for longer than necessary, and an orphaned
    // file on rollback is harmless (and cleaned up below).
    let photoUrl: string | null = null;
    if (input.photoDataUrl) {
      const stored = await savePhotoFromDataUrl(input.photoDataUrl, 'members');
      photoUrl = stored.url;
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const memberId = await nextMemberId(tx);

        const startDate = input.startDate;
        const endDate = calculateExpiryDate(startDate, plan.durationDays);

        const bill = calculateBill({
          pricePaise: plan.pricePaise,
          joiningFeePaise: input.payment.joiningFee || plan.joiningFeePaise,
          discountPaise: input.payment.discountAmount,
        });

        const member = await tx.member.create({
          data: {
            memberId,
            fullName: input.fullName,
            phone: input.phone,
            email: input.email ?? null,
            dateOfBirth: input.dateOfBirth,
            gender: input.gender,
            photoUrl,
            addressLine1: input.address?.line1 ?? null,
            addressLine2: input.address?.line2 ?? null,
            city: input.address?.city ?? 'Hyderabad',
            state: input.address?.state ?? 'Telangana',
            pincode: input.address?.pincode ?? null,
            emergencyContactName: input.emergencyContact?.name ?? null,
            emergencyContactPhone: input.emergencyContact?.phone ?? null,
            emergencyContactRelation: input.emergencyContact?.relation ?? null,
            goals: input.goals,
            medicalNotes: input.medicalNotes ?? null,
            status: MemberStatus.ACTIVE,
            joinedAt: startDate,
            trainerId: input.trainerId ?? null,
            createdById,
          },
        });

        const membership = await tx.membership.create({
          data: {
            memberId: member.id,
            planId: plan.id,
            startDate,
            endDate,
            status: MembershipStatus.ACTIVE,
            pricePaise: plan.pricePaise,
            joiningFeePaise: input.payment.joiningFee || plan.joiningFeePaise,
            discountPaise: bill.discountPaise,
            discountReason: input.payment.discountReason ?? null,
            totalPaise: bill.totalPaise,
          },
        });

        await tx.membershipEvent.create({
          data: {
            membershipId: membership.id,
            type: 'CREATED',
            details: {
              planName: plan.name,
              totalPaise: bill.totalPaise,
            } as Prisma.InputJsonValue,
            performedById: createdById,
          },
        });

        // Zero is legitimate: "pay later" is a real front-desk situation.
        let invoiceId: string | null = null;

        if (input.payment.amountPaid > 0) {
          const payment = await tx.payment.create({
            data: {
              memberId: member.id,
              membershipId: membership.id,
              amountPaise: input.payment.amountPaid,
              discountPaise: bill.discountPaise,
              discountReason: input.payment.discountReason ?? null,
              mode: input.payment.mode,
              status: PaymentStatus.PAID,
              reference: input.payment.reference ?? null,
              notes: input.payment.notes ?? null,
              paidAt: new Date(),
              collectedById: createdById,
            },
          });

          // Money taken at the desk gets a numbered receipt, exactly as a
          // payment recorded later does. Registration used to skip this, so
          // a member paid ₹4,000 and had no document for it — and the
          // welcome email had no PDF to attach.
          //
          // Inside the transaction on purpose: the document number comes
          // from a row-locked sequence, and issuing it outside would let a
          // number be consumed by a payment that then rolls back, leaving a
          // permanent gap in the book.
          await issueReceipt(tx, payment.id, member.id, membership.id);

          const invoice = await tx.invoice.findFirst({
            where: { paymentId: payment.id },
            select: { id: true },
          });
          invoiceId = invoice?.id ?? null;
        }

        return { member, membership, plan, bill, invoiceId };
      });

      const qrDataUrl = await generateQrDataUrl(
        result.member.memberId,
        result.member.qrToken,
      );

      await auditService.record({
        action: 'MEMBER_REGISTERED',
        entityType: 'Member',
        entityId: result.member.id,
        after: {
          memberId: result.member.memberId,
          fullName: result.member.fullName,
          phone: result.member.phone,
          plan: plan.name,
          totalPaise: result.bill.totalPaise,
          amountPaidPaise: input.payment.amountPaid,
        },
        actor,
      });

      log.info(
        {
          memberId: result.member.memberId,
          planName: plan.name,
          paid: result.bill.totalPaise,
        },
        'Member registered',
      );

      // Fire-and-forget: a gateway outage must not fail a completed
      // registration. Failures land in the SMS queue and surface in the UI.
      //
      // SMS is OPT-IN now, not the default. Indian transactional SMS needs
      // DLT registration to deliver at all; WhatsApp and email reach the
      // member today and cost nothing. The path stays for gyms that have
      // completed DLT.
      if (input.sendWelcomeSms) {
        void this.sendWelcomeSms({
          memberDbId: result.member.id,
          memberId: result.member.memberId,
          fullName: result.member.fullName,
          phone: result.member.phone,
          planName: plan.name,
          startDate: result.membership.startDate,
          endDate: result.membership.endDate,
          amountPaidPaise: input.payment.amountPaid,
          sentById: createdById,
        });
      }

      // Welcome email — sent whenever the member gave an address, with no
      // per-registration toggle. Unlike SMS it costs nothing and needs no
      // DLT approval, so there is no reason to make the desk decide.
      // WhatsApp — the channel most members actually read. Sent whenever we
      // have a mobile number, which is every member: phone is required.
      void this.sendWelcomeWhatsApp({
        memberDbId: result.member.id,
        memberId: result.member.memberId,
        fullName: result.member.fullName,
        phone: result.member.phone,
        planName: plan.name,
        endDate: result.membership.endDate,
        amountPaidPaise: input.payment.amountPaid,
        sentById: createdById,
      });

      if (result.member.email) {
        void this.sendWelcomeEmail({
          memberDbId: result.member.id,
          memberId: result.member.memberId,
          fullName: result.member.fullName,
          email: result.member.email,
          planName: plan.name,
          startDate: result.membership.startDate,
          endDate: result.membership.endDate,
          amountPaidPaise: input.payment.amountPaid,
          invoiceId: result.invoiceId,
          sentById: createdById,
        });
      }

      return { member: result.member, qrDataUrl };
    } catch (error) {
      // The transaction rolled back, so the photo on disk is now an orphan.
      if (photoUrl) await deletePhoto(photoUrl);
      throw error;
    }
  }

  private async sendWelcomeSms(params: {
    memberDbId: string;
    memberId: string;
    fullName: string;
    phone: string;
    planName: string;
    startDate: Date;
    endDate: Date;
    amountPaidPaise: number;
    sentById: string | null;
  }): Promise<void> {
    try {
      await smsService.send({
        to: params.phone,
        templateKey: SmsTemplateKey.WELCOME,
        memberId: params.memberDbId,
        sentById: params.sentById ?? undefined,
        variables: {
          // First name only: the template must fit one GSM-7 segment, and a
          // long full name would push it to two and double the cost.
          name: params.fullName.split(' ')[0] ?? params.fullName,
          memberId: params.memberId,
          plan: params.planName,
          startDate: formatDate(params.startDate),
          expiryDate: formatDate(params.endDate),
          amount: paiseToRupees(params.amountPaidPaise).toLocaleString('en-IN'),
          gymPhone: gymConfig.phone,
        },
      });
    } catch (error) {
      log.error(
        { err: error, memberId: params.memberId },
        'Welcome SMS failed to queue',
      );
    }
  }

  private async sendWelcomeWhatsApp(params: {
    memberDbId: string;
    memberId: string;
    fullName: string;
    phone: string;
    planName: string;
    endDate: Date;
    amountPaidPaise: number;
    sentById: string | null;
  }): Promise<void> {
    try {
      await whatsappService.send({
        to: params.phone,
        templateKey: WhatsAppTemplateKey.WELCOME,
        memberId: params.memberDbId,
        sentById: params.sentById ?? undefined,
        variables: {
          // First name only: a WhatsApp template variable has a 1024-char
          // limit but the message reads better short, and it matches how
          // the front desk would greet them.
          name: params.fullName.split(' ')[0] ?? params.fullName,
          memberId: params.memberId,
          plan: params.planName,
          expiryDate: formatDate(params.endDate),
          amount: paiseToRupees(params.amountPaidPaise).toLocaleString('en-IN'),
        },
      });
    } catch (error) {
      log.error(
        { err: error, memberId: params.memberId },
        'Welcome WhatsApp failed to queue',
      );
    }
  }

  private async sendWelcomeEmail(params: {
    memberDbId: string;
    memberId: string;
    fullName: string;
    email: string;
    planName: string;
    startDate: Date;
    endDate: Date;
    amountPaidPaise: number;
    /** The receipt raised during registration, if money changed hands. */
    invoiceId: string | null;
    sentById: string | null;
  }): Promise<void> {
    try {
      await emailService.send({
        to: params.email,
        templateKey: EmailTemplateKey.WELCOME,
        memberId: params.memberDbId,
        sentById: params.sentById ?? undefined,
        attachInvoiceId: params.invoiceId ?? undefined,
        variables: {
          // Full name here, unlike SMS: email has no segment limit, and a
          // welcome addressed to the whole name reads better.
          name: params.fullName,
          memberId: params.memberId,
          plan: params.planName,
          startDate: formatDate(params.startDate),
          expiryDate: formatDate(params.endDate),
          amount: paiseToRupees(params.amountPaidPaise).toLocaleString('en-IN'),
        },
      });
    } catch (error) {
      log.error(
        { err: error, memberId: params.memberId },
        'Welcome email failed to queue',
      );
    }
  }

  async list(params: MemberQuery): Promise<PaginatedResponse<unknown>> {
    const { skip, take } = getSkipTake(params);
    const where = this.buildWhere(params);

    const [data, total] = await Promise.all([
      prisma.member.findMany({
        where,
        skip,
        take,
        include: memberInclude,
        orderBy: buildOrderBy(
          params.sortBy,
          params.sortOrder,
          SORTABLE_FIELDS,
          'createdAt',
        ),
      }),
      prisma.member.count({ where }),
    ]);

    const withBalances = await this.attachBalances(data);

    return buildPaginatedResponse(withBalances, total, params);
  }

  private buildWhere(params: MemberQuery): Prisma.MemberWhereInput {
    const where: Prisma.MemberWhereInput = { deletedAt: null };

    if (params.search) {
      const term = params.search.trim();
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        { memberId: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term.replace(/\D/g, '') } },
        { email: { contains: term, mode: 'insensitive' } },
      ];
    }

    if (params.status) where.status = params.status;
    if (params.gender) where.gender = params.gender;
    if (params.trainerId) where.trainerId = params.trainerId;

    // Training focus. `hasSome` matches a member pursuing ANY of the selected
    // goals, which is what "show me the weight-loss and cardio members" means
    // to whoever is planning a class.
    if (params.goals && params.goals.length > 0) {
      where.goals = { hasSome: params.goals };
    }

    // Membership conditions COMBINE rather than overwrite.
    //
    // Each of these used to assign `where.memberships` directly, so selecting
    // a plan AND an expiry window silently dropped the plan filter — the list
    // looked right and quietly answered a different question. Collecting them
    // into AND keeps every condition the owner actually ticked.
    const membershipFilters: Prisma.MembershipListRelationFilter[] = [];

    if (params.planId) {
      membershipFilters.push({
        some: { planId: params.planId, status: MembershipStatus.ACTIVE },
      });
    }

    // "Expiring in N days": an active membership ending between now and the
    // cutoff. Drives both the KPI card and the reminder flow.
    if (params.expiringInDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + params.expiringInDays);
      cutoff.setHours(23, 59, 59, 999);

      membershipFilters.push({
        some: {
          status: MembershipStatus.ACTIVE,
          endDate: { gte: new Date(), lte: cutoff },
        },
      });
    }

    // "Whose membership ends in this window?" — the renewal-chasing question,
    // and the reason the date filter has a Joined/Expiring toggle rather than
    // silently picking one date for the owner.
    //
    // Deliberately NOT restricted to ACTIVE: an owner looking at a window
    // that has already passed wants the memberships that lapsed in it, and
    // those are EXPIRED by the time they look.
    if (params.expiringFrom || params.expiringTo) {
      membershipFilters.push({
        some: {
          endDate: {
            ...(params.expiringFrom ? { gte: params.expiringFrom } : {}),
            ...(params.expiringTo ? { lte: params.expiringTo } : {}),
          },
        },
      });
    }

    if (membershipFilters.length === 1) {
      where.memberships = membershipFilters[0];
    } else if (membershipFilters.length > 1) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        ...membershipFilters.map((filter) => ({ memberships: filter })),
      ];
    }

    if (params.joinedFrom || params.joinedTo) {
      where.joinedAt = {
        ...(params.joinedFrom ? { gte: params.joinedFrom } : {}),
        ...(params.joinedTo ? { lte: params.joinedTo } : {}),
      };
    }

    return where;
  }

  /**
   * Attach money figures to each member row.
   *
   * Done as two grouped aggregate queries rather than per-member lookups —
   * otherwise a 20-row page costs 40 round trips to Supabase.
   *
   * Returns total billed, total paid and the outstanding balance, because the
   * member list shows all three: "paid ₹4,000 of ₹4,500" answers a question
   * that a bare "₹500 due" does not.
   */
  private async attachBalances<T extends { id: string }>(
    members: T[],
  ): Promise<
    Array<
      T & {
        balanceDuePaise: number;
        totalPaidPaise: number;
        totalBilledPaise: number;
      }
    >
  > {
    if (members.length === 0) return [];

    const ids = members.map((m) => m.id);

    const [billed, paid] = await Promise.all([
      prisma.membership.groupBy({
        by: ['memberId'],
        where: { memberId: { in: ids } },
        _sum: { totalPaise: true },
      }),
      prisma.payment.groupBy({
        by: ['memberId'],
        where: { memberId: { in: ids }, deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
    ]);

    const billedBy = new Map(
      billed.map((b) => [b.memberId, b._sum.totalPaise ?? 0]),
    );
    const paidBy = new Map(
      paid.map((p) => [
        p.memberId,
        {
          paid: p._sum.amountPaise ?? 0,
          refunded: p._sum.refundedPaise ?? 0,
        },
      ]),
    );

    return members.map((m) => {
      const payments = paidBy.get(m.id) ?? { paid: 0, refunded: 0 };
      const totalBilledPaise = billedBy.get(m.id) ?? 0;

      return {
        ...m,
        totalBilledPaise,
        // Net of refunds — a refunded payment is not money the gym holds.
        totalPaidPaise: payments.paid - payments.refunded,
        balanceDuePaise: calculateBalance({
          totalBilledPaise,
          totalPaidPaise: payments.paid,
          totalRefundedPaise: payments.refunded,
        }),
      };
    });
  }

  /** Counts behind the member-list summary strip. */
  async getStats(): Promise<MemberStats> {
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(weekAhead.getDate() + 7);
    weekAhead.setHours(23, 59, 59, 999);

    const [statusCounts, expiringSoon, billedAgg, paidAgg] = await Promise.all([
      prisma.member.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.member.count({
        where: {
          deletedAt: null,
          memberships: {
            some: {
              status: MembershipStatus.ACTIVE,
              endDate: { gte: now, lte: weekAhead },
            },
          },
        },
      }),
      prisma.membership.aggregate({ _sum: { totalPaise: true } }),
      prisma.payment.aggregate({
        where: { deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
    ]);

    const byStatus = new Map(
      statusCounts.map((s) => [s.status, s._count._all]),
    );

    return {
      total: statusCounts.reduce((sum, s) => sum + s._count._all, 0),
      active: byStatus.get(MemberStatus.ACTIVE) ?? 0,
      expiringSoon,
      expired: byStatus.get(MemberStatus.EXPIRED) ?? 0,
      frozen: byStatus.get(MemberStatus.FROZEN) ?? 0,
      cancelled: byStatus.get(MemberStatus.CANCELLED) ?? 0,
      totalDuesPaise: calculateBalance({
        totalBilledPaise: billedAgg._sum.totalPaise ?? 0,
        totalPaidPaise: paidAgg._sum.amountPaise ?? 0,
        totalRefundedPaise: paidAgg._sum.refundedPaise ?? 0,
      }),
    };
  }

  /** Full profile: memberships, payments, attendance, dues. */
  async getProfile(id: string) {
    const member = await prisma.member.findFirst({
      where: { id, deletedAt: null },
      include: {
        memberships: {
          orderBy: { startDate: 'desc' },
          include: { plan: true, events: { orderBy: { createdAt: 'desc' } } },
        },
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          take: 50,
          include: { invoice: true },
        },
        attendance: { orderBy: { checkInAt: 'desc' }, take: 30 },
        trainer: { include: { user: { select: { id: true, fullName: true } } } },
        smsLogs: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!member) throw new NotFoundError('Member');

    const totalBilled = member.memberships.reduce(
      (sum, m) => sum + m.totalPaise,
      0,
    );
    const totalPaid = member.payments.reduce((sum, p) => sum + p.amountPaise, 0);
    const totalRefunded = member.payments.reduce(
      (sum, p) => sum + p.refundedPaise,
      0,
    );

    const qrDataUrl = await generateQrDataUrl(member.memberId, member.qrToken);

    return {
      ...member,
      qrDataUrl,
      balance: {
        totalBilledPaise: totalBilled,
        totalPaidPaise: totalPaid,
        totalRefundedPaise: totalRefunded,
        balanceDuePaise: calculateBalance({
          totalBilledPaise: totalBilled,
          totalPaidPaise: totalPaid,
          totalRefundedPaise: totalRefunded,
        }),
      },
    };
  }

  async getById(id: string): Promise<Member> {
    const member = await prisma.member.findFirst({
      where: { id, deletedAt: null },
    });
    if (!member) throw new NotFoundError('Member');
    return member;
  }

  /** Look up by the printed AZF-YYYY-NNNN code — used at the front desk. */
  async getByMemberId(memberId: string): Promise<Member> {
    const member = await prisma.member.findFirst({
      where: { memberId: memberId.trim().toUpperCase(), deletedAt: null },
    });
    if (!member) throw new NotFoundError('Member');
    return member;
  }

  async update(
    id: string,
    input: UpdateMemberInput,
    actor?: AuditActor,
  ): Promise<Member> {
    const existing = await this.getById(id);

    let photoUrl = existing.photoUrl;
    if (input.photoDataUrl) {
      const stored = await savePhotoFromDataUrl(input.photoDataUrl, 'members');
      photoUrl = stored.url;
    }

    const member = await prisma.member.update({
      where: { id },
      data: {
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email ?? null } : {}),
        ...(input.dateOfBirth !== undefined
          ? { dateOfBirth: input.dateOfBirth }
          : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(photoUrl !== existing.photoUrl ? { photoUrl } : {}),
        ...(input.address
          ? {
              addressLine1: input.address.line1 ?? null,
              addressLine2: input.address.line2 ?? null,
              city: input.address.city,
              state: input.address.state,
              pincode: input.address.pincode ?? null,
            }
          : {}),
        ...(input.emergencyContact
          ? {
              emergencyContactName: input.emergencyContact.name,
              emergencyContactPhone: input.emergencyContact.phone,
              emergencyContactRelation: input.emergencyContact.relation,
            }
          : {}),
        ...(input.goals !== undefined ? { goals: input.goals } : {}),
        ...(input.medicalNotes !== undefined
          ? { medicalNotes: input.medicalNotes }
          : {}),
        ...(input.trainerId !== undefined
          ? { trainerId: input.trainerId }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    // Replace the old photo only after the row is safely updated.
    if (input.photoDataUrl && existing.photoUrl) {
      await deletePhoto(existing.photoUrl);
    }

    // Awaited, not fire-and-forget: the write is cheap, and a trail that
    // races the response can lose entries when the process restarts.
    await auditService.recordUpdate({
      entityType: 'Member',
      entityId: member.id,
      before: existing as unknown as Record<string, unknown>,
      after: member as unknown as Record<string, unknown>,
      actor,
    });

    log.info({ memberId: member.memberId }, 'Member updated');
    return member;
  }

  /**
   * Soft-delete a member.
   *
   * The row is retained: payment and attendance history must remain
   * attributable, and a deleted member with outstanding dues is a figure the
   * owner still needs to see.
   */
  async remove(id: string, actor?: AuditActor): Promise<void> {
    const member = await this.getById(id);

    await prisma.$transaction([
      prisma.member.update({
        where: { id },
        data: { deletedAt: new Date(), status: MemberStatus.CANCELLED },
      }),
      prisma.membership.updateMany({
        where: {
          memberId: id,
          status: { in: [MembershipStatus.ACTIVE, MembershipStatus.FROZEN] },
        },
        data: { status: MembershipStatus.CANCELLED },
      }),
    ]);

    // The single most important entry in the trail. A member vanishing from
    // the list is the change most likely to be questioned later, and the one
    // an empty audit log can never answer.
    await auditService.record({
      action: 'MEMBER_DELETED',
      entityType: 'Member',
      entityId: id,
      before: {
        memberId: member.memberId,
        fullName: member.fullName,
        phone: member.phone,
        status: member.status,
      },
      after: { status: MemberStatus.CANCELLED, deletedAt: new Date().toISOString() },
      actor,
    });

    log.info({ memberId: member.memberId }, 'Member removed');
  }

  /**
   * Rotate a member's QR token, invalidating any shared screenshot of their
   * pass without changing their printed member ID.
   */
  async rotateQrToken(
    id: string,
    actor?: AuditActor,
  ): Promise<{ qrDataUrl: string }> {
    const member = await this.getById(id);

    const updated = await prisma.member.update({
      where: { id },
      data: { qrToken: crypto.randomUUID() },
    });

    // The token itself is never recorded — it is a credential, and a trail
    // that stores one hands anyone with read access a working pass.
    await auditService.record({
      action: 'MEMBER_QR_ROTATED',
      entityType: 'Member',
      entityId: id,
      after: { memberId: member.memberId },
      actor,
    });

    log.info({ memberId: member.memberId }, 'QR token rotated');

    return {
      qrDataUrl: await generateQrDataUrl(updated.memberId, updated.qrToken),
    };
  }

  /**
   * Reconcile member status against membership expiry.
   *
   * Run on a schedule. Without it, "active members" silently includes anyone
   * whose membership lapsed overnight, and every KPI built on that figure is
   * wrong.
   */
  async syncExpiredStatuses(): Promise<number> {
    const now = new Date();

    const expired = await prisma.membership.findMany({
      where: { status: MembershipStatus.ACTIVE, endDate: { lt: now } },
      select: { id: true, memberId: true },
    });

    if (expired.length === 0) return 0;

    await prisma.$transaction([
      prisma.membership.updateMany({
        where: { id: { in: expired.map((m) => m.id) } },
        data: { status: MembershipStatus.EXPIRED },
      }),
      prisma.member.updateMany({
        where: {
          id: { in: expired.map((m) => m.memberId) },
          status: MemberStatus.ACTIVE,
        },
        data: { status: MemberStatus.EXPIRED },
      }),
    ]);

    log.info({ count: expired.length }, 'Expired memberships reconciled');
    return expired.length;
  }

  /** Guard against registering the same person twice at the desk. */
  async checkDuplicatePhone(
    phone: string,
    excludeId?: string,
  ): Promise<Member | null> {
    return prisma.member.findFirst({
      where: {
        phone,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
  }
}

export const membersService = new MembersService();
