import { MemberStatus, parseQrPayload } from '@azf/shared';
import type { Member } from '@prisma/client';
import { InvalidStateError, NotFoundError } from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { calculateBalance } from '../payments/billing.js';

const log = moduleLogger('attendance');

/**
 * Check-in.
 *
 * The desk needs an answer in under a second: is this person allowed in, and
 * is there anything to mention to them? So a check-in returns not just
 * success, but the member's status, expiry and outstanding balance — the
 * three things a receptionist would otherwise have to look up separately
 * while someone waits.
 */

export interface CheckInResult {
  attendance: { id: string; checkInAt: Date };
  member: {
    id: string;
    memberId: string;
    fullName: string;
    photoUrl: string | null;
    status: MemberStatus;
  };
  membership: {
    planName: string;
    endDate: Date;
    daysRemaining: number;
  } | null;
  balanceDuePaise: number;
  /** Things worth saying aloud as the member walks past. */
  warnings: Array<{
    kind: 'EXPIRED' | 'EXPIRING' | 'DUES' | 'FROZEN' | 'ALREADY_IN';
    message: string;
  }>;
}

/** A second scan within this window is a duplicate, not a new visit. */
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

class AttendanceService {
  /**
   * Check a member in by QR payload.
   *
   * The QR carries `AZF:MEMBER:<memberId>:<token>`. Both halves are verified:
   * the printed ID alone is guessable by anyone who has seen one card, so the
   * secret token is what makes a pass unforgeable.
   */
  async checkInByQr(payload: string, markedById: string | null) {
    const parsed = parseQrPayload(payload);

    if (!parsed) {
      throw new NotFoundError('Invalid QR code');
    }

    const member = await prisma.member.findFirst({
      where: {
        memberId: parsed.memberId,
        qrToken: parsed.token,
        deletedAt: null,
      },
    });

    if (!member) {
      // Deliberately vague: distinguishing "no such member" from "wrong
      // token" would confirm which member IDs exist.
      throw new NotFoundError('Pass not recognised');
    }

    return this.checkIn(member, markedById, 'QR');
  }

  /** Check in by the printed member ID — for a forgotten or damaged pass. */
  async checkInByMemberId(memberId: string, markedById: string | null) {
    const member = await prisma.member.findFirst({
      where: { memberId: memberId.trim().toUpperCase(), deletedAt: null },
    });

    if (!member) throw new NotFoundError('Member');

    return this.checkIn(member, markedById, 'MANUAL');
  }

  private async checkIn(
    member: Member,
    markedById: string | null,
    method: 'QR' | 'MANUAL',
  ): Promise<CheckInResult> {
    if (member.status === MemberStatus.CANCELLED) {
      throw new InvalidStateError(
        `${member.fullName} has a cancelled membership`,
      );
    }

    const now = new Date();

    const [membership, recent, billed, paid] = await Promise.all([
      prisma.membership.findFirst({
        where: { memberId: member.id, status: { in: ['ACTIVE', 'FROZEN'] } },
        orderBy: { endDate: 'desc' },
        include: { plan: { select: { name: true } } },
      }),
      // Guards against the scanner firing twice, or a member scanning again
      // because they did not see the confirmation.
      prisma.attendance.findFirst({
        where: {
          memberId: member.id,
          checkInAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
        },
        orderBy: { checkInAt: 'desc' },
      }),
      prisma.membership.aggregate({
        where: { memberId: member.id },
        _sum: { totalPaise: true },
      }),
      prisma.payment.aggregate({
        where: { memberId: member.id, deletedAt: null },
        _sum: { amountPaise: true, refundedPaise: true },
      }),
    ]);

    const balanceDuePaise = calculateBalance({
      totalBilledPaise: billed._sum.totalPaise ?? 0,
      totalPaidPaise: paid._sum.amountPaise ?? 0,
      totalRefundedPaise: paid._sum.refundedPaise ?? 0,
    });

    const warnings: CheckInResult['warnings'] = [];

    // Reuse the existing row rather than creating a second visit.
    const attendance =
      recent ??
      (await prisma.attendance.create({
        data: { memberId: member.id, method, markedById },
      }));

    if (recent) {
      warnings.push({
        kind: 'ALREADY_IN',
        message: 'Already checked in a few minutes ago',
      });
    }

    let daysRemaining = 0;

    if (membership) {
      daysRemaining = Math.ceil(
        (membership.endDate.getTime() - now.getTime()) / 86_400_000,
      );

      if (membership.status === 'FROZEN') {
        warnings.push({
          kind: 'FROZEN',
          message: 'Membership is currently frozen',
        });
      } else if (daysRemaining < 0) {
        warnings.push({
          kind: 'EXPIRED',
          message: `Membership expired ${Math.abs(daysRemaining)} days ago`,
        });
      } else if (daysRemaining <= 7) {
        warnings.push({
          kind: 'EXPIRING',
          message:
            daysRemaining === 0
              ? 'Membership expires today'
              : `Membership expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
        });
      }
    } else {
      warnings.push({
        kind: 'EXPIRED',
        message: 'No active membership on record',
      });
    }

    if (balanceDuePaise > 0) {
      warnings.push({
        kind: 'DUES',
        message: `₹${Math.round(balanceDuePaise / 100).toLocaleString('en-IN')} outstanding`,
      });
    }

    log.info(
      { memberId: member.memberId, method, warnings: warnings.length },
      'Member checked in',
    );

    return {
      attendance: { id: attendance.id, checkInAt: attendance.checkInAt },
      member: {
        id: member.id,
        memberId: member.memberId,
        fullName: member.fullName,
        photoUrl: member.photoUrl,
        status: member.status,
      },
      membership: membership
        ? {
            planName: membership.plan.name,
            endDate: membership.endDate,
            daysRemaining,
          }
        : null,
      balanceDuePaise,
      warnings,
    };
  }

  /** Who is currently in the gym — checked in today without checking out. */
  async getCurrentlyIn() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    return prisma.attendance.findMany({
      where: { checkInAt: { gte: since }, checkOutAt: null },
      orderBy: { checkInAt: 'desc' },
      include: {
        member: {
          select: {
            id: true,
            memberId: true,
            fullName: true,
            photoUrl: true,
          },
        },
      },
    });
  }

  async checkOut(attendanceId: string) {
    const attendance = await prisma.attendance.findUnique({
      where: { id: attendanceId },
    });

    if (!attendance) throw new NotFoundError('Check-in');
    if (attendance.checkOutAt) {
      throw new InvalidStateError('This visit is already checked out');
    }

    return prisma.attendance.update({
      where: { id: attendanceId },
      data: { checkOutAt: new Date() },
    });
  }

  /** Today's totals for the check-in screen header. */
  async getTodayStats() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const [total, currentlyIn] = await Promise.all([
      prisma.attendance.count({ where: { checkInAt: { gte: since } } }),
      prisma.attendance.count({
        where: { checkInAt: { gte: since }, checkOutAt: null },
      }),
    ]);

    return { total, currentlyIn };
  }
}

export const attendanceService = new AttendanceService();
