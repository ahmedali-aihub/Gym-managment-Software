import type {
  FreezeMembershipInput,
  RenewMembershipInput,
  TransferMembershipInput,
  UpgradeMembershipInput,
} from '@azf/shared';
import {
  MemberStatus,
  MembershipStatus,
  PaymentStatus,
  SmsTemplateKey,
  addDays,
  calculateExpiryDate,
  daysUntil,
  formatDate,
  paiseToRupees,
  startOfDay,
} from '@azf/shared';
import type { Membership, Prisma } from '@prisma/client';
import { gymConfig } from '../../config/env.js';
import {
  InvalidStateError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { smsService } from '../../services/sms/sms.service.js';
import {
  calculateBill,
  calculateProratedCredit,
  calculateUpgradeDue,
} from '../payments/billing.js';

const log = moduleLogger('memberships');

class MembershipsService {
  /**
   * Freeze a membership.
   *
   * Freezing preserves paid-for days: the expiry date is extended by exactly
   * the number of days frozen when the membership resumes. Without that, a
   * member who pauses for a month silently loses a month they already paid
   * for — which is the kind of thing that ends in an argument at the desk.
   */
  async freeze(
    input: FreezeMembershipInput,
    actorId: string | null,
  ): Promise<Membership> {
    const membership = await this.getActiveMembership(input.membershipId);

    if (membership.status === MembershipStatus.FROZEN) {
      throw new InvalidStateError('This membership is already frozen');
    }

    const plan = await prisma.plan.findUniqueOrThrow({
      where: { id: membership.planId },
    });

    if (plan.maxFreezeDays === 0) {
      throw new InvalidStateError(
        `The ${plan.name} plan does not allow freezing`,
      );
    }

    // Enforce the plan's freeze allowance across the whole membership, not
    // per freeze — otherwise repeated short freezes bypass the limit.
    if (input.endDate) {
      const requestedDays = Math.ceil(
        (input.endDate.getTime() - input.startDate.getTime()) / 86_400_000,
      );
      const remaining = plan.maxFreezeDays - membership.freezeDaysUsed;

      if (requestedDays > remaining) {
        throw new ValidationError('Freeze period exceeds the plan allowance', {
          endDate: [
            `Only ${remaining} of ${plan.maxFreezeDays} freeze days remain on this plan`,
          ],
        });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.membership.update({
        where: { id: input.membershipId },
        data: {
          status: MembershipStatus.FROZEN,
          freezeStartDate: input.startDate,
          freezeEndDate: input.endDate ?? null,
          freezeReason: input.reason,
        },
      });

      await tx.member.update({
        where: { id: membership.memberId },
        data: { status: MemberStatus.FROZEN },
      });

      await tx.membershipEvent.create({
        data: {
          membershipId: input.membershipId,
          type: 'FROZEN',
          details: {
            startDate: input.startDate.toISOString(),
            endDate: input.endDate?.toISOString() ?? null,
            reason: input.reason,
          } as Prisma.InputJsonValue,
          performedById: actorId,
        },
      });

      return result;
    });

    log.info({ membershipId: input.membershipId }, 'Membership frozen');
    return updated;
  }

  /**
   * Resume a frozen membership, extending expiry by the days it was paused.
   */
  async unfreeze(
    membershipId: string,
    resumeDate: Date,
    actorId: string | null,
  ): Promise<Membership> {
    const membership = await prisma.membership.findUnique({
      where: { id: membershipId },
    });
    if (!membership) throw new NotFoundError('Membership');

    if (membership.status !== MembershipStatus.FROZEN) {
      throw new InvalidStateError('This membership is not frozen');
    }
    if (!membership.freezeStartDate) {
      throw new InvalidStateError('No freeze start date is recorded');
    }

    // Whole days only, and never negative if the clock is off.
    const frozenDays = Math.max(
      0,
      Math.round(
        (startOfDay(resumeDate).getTime() -
          startOfDay(membership.freezeStartDate).getTime()) /
          86_400_000,
      ),
    );

    const newEndDate = addDays(membership.endDate, frozenDays);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.membership.update({
        where: { id: membershipId },
        data: {
          status: MembershipStatus.ACTIVE,
          endDate: newEndDate,
          freezeDaysUsed: membership.freezeDaysUsed + frozenDays,
          freezeStartDate: null,
          freezeEndDate: null,
          freezeReason: null,
        },
      });

      await tx.member.update({
        where: { id: membership.memberId },
        data: { status: MemberStatus.ACTIVE },
      });

      await tx.membershipEvent.create({
        data: {
          membershipId,
          type: 'UNFROZEN',
          details: {
            frozenDays,
            previousEndDate: membership.endDate.toISOString(),
            newEndDate: newEndDate.toISOString(),
          } as Prisma.InputJsonValue,
          performedById: actorId,
        },
      });

      return result;
    });

    log.info(
      { membershipId, frozenDays, newEndDate },
      'Membership unfrozen and expiry extended',
    );
    return updated;
  }

  /**
   * Preview an upgrade without committing it.
   *
   * The front desk needs to quote a figure before taking money, and that
   * figure must come from the same code path that will later charge it —
   * otherwise the quote and the charge can disagree.
   */
  async previewUpgrade(input: UpgradeMembershipInput): Promise<{
    creditPaise: number;
    newPlanPricePaise: number;
    duePaise: number;
    remainingDays: number;
  }> {
    const membership = await this.getActiveMembership(input.membershipId);

    const newPlan = await prisma.plan.findFirst({
      where: { id: input.newPlanId, deletedAt: null },
    });
    if (!newPlan) throw new NotFoundError('Plan');

    const remainingDays = Math.max(0, daysUntil(membership.endDate));
    const totalDays = Math.max(
      1,
      Math.round(
        (membership.endDate.getTime() - membership.startDate.getTime()) /
          86_400_000,
      ) + 1,
    );

    const paid = await prisma.payment.aggregate({
      where: { membershipId: membership.id, deletedAt: null },
      _sum: { amountPaise: true },
    });

    const creditPaise = input.creditRemainingDays
      ? calculateProratedCredit({
          totalPaidPaise: paid._sum.amountPaise ?? 0,
          totalDays,
          remainingDays,
        })
      : 0;

    const bill = calculateBill({ pricePaise: newPlan.pricePaise });
    const { duePaise } = calculateUpgradeDue({
      newPlanPricePaise: bill.totalPaise,
      creditPaise,
      discountPaise: input.discountAmount,
    });

    return {
      creditPaise,
      newPlanPricePaise: bill.totalPaise,
      duePaise,
      remainingDays,
    };
  }

  /**
   * Upgrade to a different plan mid-cycle.
   *
   * The old membership is marked UPGRADED and linked to its successor rather
   * than edited in place, so the history of what the member actually bought
   * stays intact.
   */
  async upgrade(
    input: UpgradeMembershipInput,
    actorId: string | null,
  ): Promise<Membership> {
    const membership = await this.getActiveMembership(input.membershipId);
    const preview = await this.previewUpgrade(input);

    const newPlan = await prisma.plan.findFirstOrThrow({
      where: { id: input.newPlanId, deletedAt: null },
    });

    const startDate = input.effectiveDate;
    const endDate = calculateExpiryDate(startDate, newPlan.durationDays);

    const created = await prisma.$transaction(async (tx) => {
      const newMembership = await tx.membership.create({
        data: {
          memberId: membership.memberId,
          planId: newPlan.id,
          startDate,
          endDate,
          status: MembershipStatus.ACTIVE,
          pricePaise: newPlan.pricePaise,
          joiningFeePaise: 0,
          // The credit is modelled as a discount on the new membership: it
          // keeps totalPaise equal to what is genuinely owed, so the dues
          // calculation needs no special case for upgrades.
          discountPaise: preview.creditPaise + input.discountAmount,
          discountReason: `Upgrade credit from previous plan${
            input.discountAmount > 0 ? ' plus discount' : ''
          }`,
          totalPaise: preview.duePaise,
        },
      });

      await tx.membership.update({
        where: { id: membership.id },
        data: {
          status: MembershipStatus.UPGRADED,
          supersededById: newMembership.id,
        },
      });

      await tx.membershipEvent.createMany({
        data: [
          {
            membershipId: membership.id,
            type: 'UPGRADED',
            details: {
              toPlan: newPlan.name,
              creditPaise: preview.creditPaise,
              newMembershipId: newMembership.id,
            } as Prisma.InputJsonValue,
            notes: input.notes ?? null,
            performedById: actorId,
          },
          {
            membershipId: newMembership.id,
            type: 'CREATED',
            details: {
              upgradedFrom: membership.id,
              duePaise: preview.duePaise,
            } as Prisma.InputJsonValue,
            performedById: actorId,
          },
        ],
      });

      return newMembership;
    });

    log.info(
      {
        from: membership.id,
        to: created.id,
        creditPaise: preview.creditPaise,
        duePaise: preview.duePaise,
      },
      'Membership upgraded',
    );

    return created;
  }

  /**
   * Transfer the remaining membership to another member.
   *
   * The remaining days move to a new membership on the recipient; the
   * original is closed as TRANSFERRED. Both sides get an audit event, because
   * "where did these days come from" is a question that gets asked.
   */
  async transfer(
    input: TransferMembershipInput,
    actorId: string | null,
  ): Promise<Membership> {
    const membership = await this.getActiveMembership(input.membershipId);

    if (!input.toMemberId) {
      throw new ValidationError('A recipient is required', {
        toMemberId: ['Select the member who will receive this membership'],
      });
    }

    if (input.toMemberId === membership.memberId) {
      throw new ValidationError('Invalid recipient', {
        toMemberId: ['A membership cannot be transferred to the same member'],
      });
    }

    const recipient = await prisma.member.findFirst({
      where: { id: input.toMemberId, deletedAt: null },
    });
    if (!recipient) throw new NotFoundError('Recipient member');

    const existingActive = await prisma.membership.findFirst({
      where: {
        memberId: input.toMemberId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.FROZEN] },
      },
    });
    if (existingActive) {
      throw new InvalidStateError(
        'The recipient already has an active membership',
      );
    }

    const remainingDays = Math.max(0, daysUntil(membership.endDate));
    if (remainingDays === 0) {
      throw new InvalidStateError(
        'This membership has expired and cannot be transferred',
      );
    }

    const startDate = new Date();
    const endDate = calculateExpiryDate(startDate, remainingDays);

    const created = await prisma.$transaction(async (tx) => {
      const newMembership = await tx.membership.create({
        data: {
          memberId: input.toMemberId!,
          planId: membership.planId,
          startDate,
          endDate,
          status: MembershipStatus.ACTIVE,
          pricePaise: 0,
          joiningFeePaise: 0,
          // Only the transfer fee is owed; the membership itself was paid for
          // by the original member.
          totalPaise: input.transferFeePaise,
          discountPaise: 0,
          discountReason: `Transferred from ${membership.memberId}`,
        },
      });

      await tx.membership.update({
        where: { id: membership.id },
        data: {
          status: MembershipStatus.TRANSFERRED,
          supersededById: newMembership.id,
        },
      });

      await tx.member.update({
        where: { id: input.toMemberId! },
        data: { status: MemberStatus.ACTIVE },
      });

      // The original member has no active membership left.
      await tx.member.update({
        where: { id: membership.memberId },
        data: { status: MemberStatus.EXPIRED },
      });

      await tx.membershipEvent.createMany({
        data: [
          {
            membershipId: membership.id,
            type: 'TRANSFERRED_OUT',
            details: {
              toMemberId: input.toMemberId,
              remainingDays,
            } as Prisma.InputJsonValue,
            notes: input.reason,
            performedById: actorId,
          },
          {
            membershipId: newMembership.id,
            type: 'TRANSFERRED_IN',
            details: {
              fromMembershipId: membership.id,
              remainingDays,
            } as Prisma.InputJsonValue,
            notes: input.reason,
            performedById: actorId,
          },
        ],
      });

      return newMembership;
    });

    log.info(
      { from: membership.id, to: created.id, remainingDays },
      'Membership transferred',
    );

    return created;
  }

  /**
   * Renew a membership.
   *
   * When renewing before expiry, the new period starts the day after the
   * current one ends rather than today — a member who renews a week early
   * should not forfeit that week.
   */
  async renew(
    input: RenewMembershipInput,
    actorId: string | null,
  ): Promise<Membership> {
    const member = await prisma.member.findFirst({
      where: { id: input.memberId, deletedAt: null },
    });
    if (!member) throw new NotFoundError('Member');

    const plan = await prisma.plan.findFirst({
      where: { id: input.planId, deletedAt: null },
    });
    if (!plan) throw new NotFoundError('Plan');

    const current = await prisma.membership.findFirst({
      where: {
        memberId: input.memberId,
        status: { in: [MembershipStatus.ACTIVE, MembershipStatus.EXPIRED] },
      },
      orderBy: { endDate: 'desc' },
    });

    let startDate: Date;
    if (input.startDate) {
      startDate = input.startDate;
    } else if (
      input.continueFromExpiry &&
      current &&
      current.endDate > new Date()
    ) {
      startDate = addDays(current.endDate, 1);
    } else {
      startDate = new Date();
    }

    const endDate = calculateExpiryDate(startDate, plan.durationDays);

    const bill = calculateBill({
      pricePaise: plan.pricePaise,
      // No joining fee on renewal — it is an admission charge, paid once.
      joiningFeePaise: 0,
      discountPaise: input.payment.discountAmount,
    });

    const created = await prisma.$transaction(async (tx) => {
      if (current?.status === MembershipStatus.ACTIVE) {
        await tx.membership.update({
          where: { id: current.id },
          data: { status: MembershipStatus.EXPIRED },
        });
      }

      const membership = await tx.membership.create({
        data: {
          memberId: input.memberId,
          planId: plan.id,
          startDate,
          endDate,
          status: MembershipStatus.ACTIVE,
          pricePaise: plan.pricePaise,
          joiningFeePaise: 0,
          discountPaise: bill.discountPaise,
          discountReason: input.payment.discountReason ?? null,
          totalPaise: bill.totalPaise,
        },
      });

      await tx.member.update({
        where: { id: input.memberId },
        data: { status: MemberStatus.ACTIVE },
      });

      if (input.payment.amountPaid > 0) {
        await tx.payment.create({
          data: {
            memberId: input.memberId,
            membershipId: membership.id,
            amountPaise: input.payment.amountPaid,
            discountPaise: bill.discountPaise,
            discountReason: input.payment.discountReason ?? null,
            mode: input.payment.mode,
            status: PaymentStatus.PAID,
            reference: input.payment.reference ?? null,
            notes: input.payment.notes ?? null,
            paidAt: new Date(),
            collectedById: actorId,
          },
        });
      }

      await tx.membershipEvent.create({
        data: {
          membershipId: membership.id,
          type: 'RENEWED',
          details: {
            planName: plan.name,
            previousMembershipId: current?.id ?? null,
            totalPaise: bill.totalPaise,
          } as Prisma.InputJsonValue,
          performedById: actorId,
        },
      });

      return membership;
    });

    log.info(
      { memberId: member.memberId, planName: plan.name },
      'Membership renewed',
    );

    if (input.sendSms) {
      void smsService
        .send({
          to: member.phone,
          templateKey: SmsTemplateKey.WELCOME,
          memberId: member.id,
          sentById: actorId ?? undefined,
          variables: {
            name: member.fullName.split(' ')[0] ?? member.fullName,
            memberId: member.memberId,
            plan: plan.name,
            startDate: formatDate(startDate),
            expiryDate: formatDate(endDate),
            amount: paiseToRupees(input.payment.amountPaid).toLocaleString(
              'en-IN',
            ),
            gymPhone: gymConfig.phone,
          },
        })
        .catch((error: unknown) => {
          log.error({ err: error }, 'Renewal SMS failed');
        });
    }

    return created;
  }

  /** Memberships expiring within N days — drives reminders and the KPI card. */
  async getExpiring(withinDays = 7) {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + withinDays);
    cutoff.setHours(23, 59, 59, 999);

    return prisma.membership.findMany({
      where: {
        status: MembershipStatus.ACTIVE,
        endDate: { gte: now, lte: cutoff },
      },
      include: {
        member: {
          select: {
            id: true,
            memberId: true,
            fullName: true,
            phone: true,
            photoUrl: true,
          },
        },
        plan: { select: { id: true, name: true } },
      },
      orderBy: { endDate: 'asc' },
    });
  }

  private async getActiveMembership(id: string): Promise<Membership> {
    const membership = await prisma.membership.findUnique({ where: { id } });
    if (!membership) throw new NotFoundError('Membership');

    if (
      membership.status !== MembershipStatus.ACTIVE &&
      membership.status !== MembershipStatus.FROZEN
    ) {
      throw new InvalidStateError(
        `This membership is ${membership.status.toLowerCase()} and cannot be modified`,
      );
    }

    return membership;
  }
}

export const membershipsService = new MembershipsService();
