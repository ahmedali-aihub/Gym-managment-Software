import { MemberStatus, MembershipStatus } from '@azf/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { moduleLogger } from '../../lib/logger.js';
import { nextMemberId } from '../../lib/sequences.js';
import {
  type AuditActor,
  auditService,
} from '../../services/audit/audit.service.js';
import {
  PLACEHOLDER_DOB,
  type ParsedMember,
} from './parse-import.js';

const log = moduleLogger('import');

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: Array<{ rowNumber: number; reason: string }>;
}

/**
 * Write parsed legacy members into the database.
 *
 * BATCHED, NOT ONE BIG TRANSACTION. 6,500 rows inside a single transaction
 * holds locks for minutes against a pooled Supabase connection and will time
 * out; worse, one bad row at 6,400 discards everything before it. Batches of
 * 50 commit independently, so a failure costs at most 50 rows and the report
 * names them.
 *
 * Every imported member is tagged in `notes` and carries an audit entry, so
 * "where did this member come from?" has an answer years later.
 */
class ImportService {
  async importMembers(
    rows: ParsedMember[],
    options: {
      /** Rows the owner chose to skip, by row number. */
      skipRows?: number[];
      actor?: AuditActor;
      createdById?: string | null;
    } = {},
  ): Promise<ImportResult> {
    const skip = new Set(options.skipRows ?? []);
    const importable = rows.filter(
      (row) => row.member !== null && !skip.has(row.rowNumber),
    );

    const failed: ImportResult['failed'] = [];
    let imported = 0;

    // Plans are matched by name once, not per row — 6,500 lookups of a table
    // with eight rows is pure round-trip cost.
    const plans = await prisma.plan.findMany({
      select: { id: true, name: true, durationDays: true, pricePaise: true },
    });
    const planByName = new Map(
      plans.map((plan) => [plan.name.trim().toLowerCase(), plan]),
    );

    const BATCH = 50;
    for (let start = 0; start < importable.length; start += BATCH) {
      const batch = importable.slice(start, start + BATCH);

      try {
        await prisma.$transaction(async (tx) => {
          for (const row of batch) {
            const member = row.member!;
            const joinedAt = member.joinedAt ?? new Date();

            // Member IDs are per-year, so a member who joined in 2019 gets
            // an AZF-2019-nnnn code rather than being renumbered into this
            // year's sequence.
            const memberCode = await nextMemberId(tx, joinedAt.getFullYear());

            const created = await tx.member.create({
              data: {
                memberId: memberCode,
                fullName: member.fullName,
                phone: member.phone,
                email: member.email,
                // A placeholder rather than a guess: 1 Jan 1900 can never be
                // mistaken for a real birth date, sorts to the top of any
                // "needs attention" list, and keeps the member out of
                // birthday reminders.
                dateOfBirth: member.dateOfBirth ?? PLACEHOLDER_DOB,
                gender: member.gender ?? 'OTHER',
                status: member.status,
                joinedAt,
                notes: buildNotes(member.notes, member.incompleteFields),
                createdById: options.createdById ?? null,
              },
            });

            // A membership is only created when the old system gave us an
            // expiry date. Without one there is nothing truthful to record,
            // and inventing a period would produce wrong renewal dates.
            const plan = member.planName
              ? planByName.get(member.planName.trim().toLowerCase())
              : undefined;

            if (member.membershipEnd && plan) {
              await tx.membership.create({
                data: {
                  memberId: created.id,
                  planId: plan.id,
                  startDate: joinedAt,
                  endDate: member.membershipEnd,
                  status:
                    member.status === MemberStatus.ACTIVE
                      ? MembershipStatus.ACTIVE
                      : MembershipStatus.EXPIRED,
                  pricePaise: plan.pricePaise,
                  joiningFeePaise: 0,
                  discountPaise: 0,
                  // NO payment or invoice is created. The money was taken in
                  // the old system; raising a receipt here would invent a
                  // transaction and corrupt every revenue figure.
                  totalPaise: 0,
                },
              });
            }

            imported++;
          }
        }, { maxWait: 10_000, timeout: 30_000 });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message.slice(0, 200) : String(error);
        for (const row of batch) {
          failed.push({ rowNumber: row.rowNumber, reason });
        }
        log.error(
          { err: error, from: batch[0]?.rowNumber, to: batch.at(-1)?.rowNumber },
          'Import batch failed',
        );
      }
    }

    await auditService.record({
      action: 'MEMBERS_IMPORTED',
      entityType: 'Import',
      after: {
        rowsSubmitted: rows.length,
        imported,
        skipped: rows.length - importable.length,
        failed: failed.length,
      },
      actor: options.actor ?? null,
    });

    log.info({ imported, failed: failed.length }, 'Member import finished');

    return {
      imported,
      skipped: rows.length - importable.length,
      failed,
    };
  }

  /** Phone numbers that already exist, so the preview can warn before writing. */
  async findExistingPhones(phones: string[]): Promise<string[]> {
    if (phones.length === 0) return [];

    const existing = await prisma.member.findMany({
      where: { phone: { in: phones }, deletedAt: null },
      select: { phone: true },
    });
    return existing.map((m) => m.phone);
  }
}

/**
 * Tag the member as imported and flag what the old system did not have.
 *
 * Written into `notes` because that is what the front desk actually reads
 * when a member is standing there — a dedicated column would need a UI
 * nobody would look at.
 */
function buildNotes(
  existing: string | null,
  incompleteFields: string[],
): string {
  const parts: string[] = [];
  if (existing) parts.push(existing);
  parts.push('[Imported from previous system]');

  if (incompleteFields.length > 0) {
    const labels = incompleteFields
      .map((f) => (f === 'dateOfBirth' ? 'date of birth' : f))
      .join(', ');
    parts.push(`Missing ${labels} — please confirm on next visit.`);
  }

  return parts.join(' ');
}

export const importService = new ImportService();
export type { Prisma };
