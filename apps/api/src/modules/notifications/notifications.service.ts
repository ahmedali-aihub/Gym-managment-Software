import {
  EmailTemplateKey,
  SmsTemplateKey,
  WhatsAppTemplateKey,
  formatDate,
  paiseToRupees,
} from '@azf/shared';
import { gymConfig } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { moduleLogger } from '../../lib/logger.js';
import { emailService } from '../../services/email/email.service.js';
import { smsService } from '../../services/sms/sms.service.js';
import { whatsappService } from '../../services/whatsapp/whatsapp.service.js';

const log = moduleLogger('notifications');

export type NotificationChannel = 'whatsapp' | 'email' | 'sms';
export type NotificationKind = 'EXPIRY_REMINDER' | 'PAYMENT_DUE';

export interface SendResult {
  memberId: string;
  memberCode: string;
  fullName: string;
  whatsapp?: 'sent' | 'failed' | 'skipped';
  email?: 'sent' | 'failed' | 'skipped';
  sms?: 'sent' | 'failed' | 'skipped';
}

/**
 * One reminder, across whichever channels the owner chose.
 *
 * Three channels, three delivery stories, one call site. Keeping the fan-out
 * here rather than in each controller means "notify this member" is one
 * decision, and adding a fourth channel later touches one file.
 *
 * CHANNELS FAIL INDEPENDENTLY. A member with no email still gets WhatsApp;
 * a WhatsApp rejection does not stop the email. The result names what
 * happened per channel per member, because "42 reminders sent" is not a
 * useful answer when eleven of them silently went nowhere.
 *
 * Nothing here throws. A reminder is a courtesy; failing one must never
 * break the screen the owner is standing in front of.
 */
class NotificationsService {
  async sendReminders(params: {
    memberIds: string[];
    kind: NotificationKind;
    channels: NotificationChannel[];
    sentById?: string;
  }): Promise<{ results: SendResult[]; summary: Record<string, number> }> {
    const members = await prisma.member.findMany({
      where: { id: { in: params.memberIds }, deletedAt: null },
      select: {
        id: true,
        memberId: true,
        fullName: true,
        phone: true,
        email: true,
        memberships: {
          where: { status: { in: ['ACTIVE', 'FROZEN', 'EXPIRED'] } },
          orderBy: { endDate: 'desc' },
          take: 1,
          select: { endDate: true },
        },
      },
    });

    const results: SendResult[] = [];

    for (const member of members) {
      const expiry = member.memberships[0]?.endDate ?? null;
      const balance = await this.getBalance(member.id);

      const result: SendResult = {
        memberId: member.id,
        memberCode: member.memberId,
        fullName: member.fullName,
      };

      const firstName = member.fullName.split(' ')[0] ?? member.fullName;
      const daysLeft = expiry
        ? Math.max(
            0,
            Math.ceil((expiry.getTime() - Date.now()) / 86_400_000),
          )
        : 0;

      // ── WhatsApp ───────────────────────────────────────────────────
      if (params.channels.includes('whatsapp')) {
        try {
          await whatsappService.send({
            to: member.phone,
            templateKey:
              params.kind === 'EXPIRY_REMINDER'
                ? WhatsAppTemplateKey.EXPIRY_REMINDER
                : WhatsAppTemplateKey.PAYMENT_DUE,
            memberId: member.id,
            sentById: params.sentById,
            variables: {
              name: firstName,
              memberId: member.memberId,
              expiryDate: expiry ? formatDate(expiry) : '—',
              amount: paiseToRupees(balance).toLocaleString('en-IN'),
            },
          });
          result.whatsapp = 'sent';
        } catch (error) {
          log.error({ err: error, memberId: member.memberId }, 'WhatsApp reminder failed');
          result.whatsapp = 'failed';
        }
      }

      // ── Email ──────────────────────────────────────────────────────
      if (params.channels.includes('email')) {
        if (!member.email) {
          // Not a failure — the member never gave an address. Reporting it
          // as skipped tells the owner who to ask next time they visit.
          result.email = 'skipped';
        } else {
          try {
            await emailService.send({
              to: member.email,
              templateKey:
                params.kind === 'EXPIRY_REMINDER'
                  ? EmailTemplateKey.EXPIRY_REMINDER
                  : EmailTemplateKey.PAYMENT_DUE,
              memberId: member.id,
              sentById: params.sentById,
              variables: {
                name: firstName,
                memberId: member.memberId,
                expiryDate: expiry ? formatDate(expiry) : '—',
                days: daysLeft,
                amount: paiseToRupees(balance).toLocaleString('en-IN'),
              },
            });
            result.email = 'sent';
          } catch (error) {
            log.error({ err: error, memberId: member.memberId }, 'Email reminder failed');
            result.email = 'failed';
          }
        }
      }

      // ── SMS ────────────────────────────────────────────────────────
      if (params.channels.includes('sms')) {
        try {
          await smsService.send({
            to: member.phone,
            templateKey:
              params.kind === 'EXPIRY_REMINDER'
                ? SmsTemplateKey.EXPIRY_REMINDER
                : SmsTemplateKey.DUES_REMINDER,
            memberId: member.id,
            sentById: params.sentById,
            variables: {
              name: firstName,
              memberId: member.memberId,
              expiryDate: expiry ? formatDate(expiry) : '—',
              amount: paiseToRupees(balance).toLocaleString('en-IN'),
              gymPhone: gymConfig.phone,
            },
          });
          result.sms = 'sent';
        } catch (error) {
          log.error({ err: error, memberId: member.memberId }, 'SMS reminder failed');
          result.sms = 'failed';
        }
      }

      results.push(result);
    }

    const summary: Record<string, number> = {
      members: results.length,
      whatsappSent: results.filter((r) => r.whatsapp === 'sent').length,
      emailSent: results.filter((r) => r.email === 'sent').length,
      emailSkipped: results.filter((r) => r.email === 'skipped').length,
      smsSent: results.filter((r) => r.sms === 'sent').length,
      failed: results.filter(
        (r) => r.whatsapp === 'failed' || r.email === 'failed' || r.sms === 'failed',
      ).length,
    };

    log.info(summary, 'Reminders sent');
    return { results, summary };
  }

  /** Outstanding balance in paise. */
  private async getBalance(memberId: string): Promise<number> {
    const [billed, paid] = await Promise.all([
      prisma.membership.aggregate({
        where: { memberId, status: { not: 'CANCELLED' } },
        _sum: { totalPaise: true },
      }),
      prisma.payment.aggregate({
        where: { memberId, deletedAt: null, status: { in: ['PAID', 'PARTIAL'] } },
        _sum: { amountPaise: true },
      }),
    ]);

    return Math.max(
      0,
      (billed._sum.totalPaise ?? 0) - (paid._sum.amountPaise ?? 0),
    );
  }
}

export const notificationsService = new NotificationsService();
