import type { Role } from '@azf/shared';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../../lib/prisma.js';
import { moduleLogger } from '../../lib/logger.js';

const log = moduleLogger('audit');

/**
 * Audit trail.
 *
 * Who changed what, when, and what it looked like before. For a business
 * handling cash across several staff, "the expiry date is wrong and nobody
 * knows who changed it" is not a recoverable situation — the trail is the
 * only thing that makes an edit answerable.
 *
 * WRITES NEVER THROW. An audit failure must not roll back the member edit
 * that triggered it: losing the record of a change is bad, but losing the
 * change itself while the receptionist believes it saved is worse. Failures
 * are logged at error level so they surface without breaking the desk.
 *
 * Entries are immutable by convention — nothing in the app updates or
 * deletes them. The trail is only worth having if it cannot be tidied up.
 */

export interface AuditActor {
  id: string | null;
  name: string | null;
  role: Role | null;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Fields never worth storing, or actively unsafe to keep a copy of. */
const REDACTED_KEYS = new Set([
  // Credentials — a trail holding a live QR token hands anyone with read
  // access a working gym pass.
  'passwordHash',
  'password',
  'qrToken',
  'refreshToken',
  'tokenVersion',
  // Bookkeeping Prisma maintains itself. `updatedAt` changes on EVERY write,
  // so without this every entry reads "phone, updatedAt" and the reviewer
  // has to mentally filter noise out of the one thing that mattered.
  'updatedAt',
  'createdAt',
  'deletedAt',
]);

/**
 * Reduce a record to the fields that actually changed.
 *
 * Storing whole rows makes the trail unreadable: a phone-number correction
 * would show forty identical fields and one different one, and the reviewer
 * has to diff it by eye. Keeping only the delta means the entry answers
 * "what changed" at a glance.
 */
export function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (REDACTED_KEYS.has(key)) continue;

    const previous = before[key];
    const next = after[key];

    // Dates and Decimals compare wrongly with ===; serialise both sides.
    if (serialise(previous) === serialise(next)) continue;

    changedBefore[key] = normalise(previous);
    changedAfter[key] = normalise(next);
  }

  // An update that changed nothing is not worth an entry.
  if (Object.keys(changedAfter).length === 0) return null;

  return { before: changedBefore, after: changedAfter };
}

function serialise(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return 'null';
  return JSON.stringify(value) ?? String(value);
}

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  // Prisma Decimal and BigInt are not JSON-serialisable as-is.
  if (typeof value === 'bigint') return value.toString();
  if (
    typeof value === 'object' &&
    value !== null &&
    'toFixed' in value &&
    typeof (value as { toFixed: unknown }).toFixed === 'function'
  ) {
    return String(value);
  }
  return value;
}

/**
 * Build an actor from the request.
 *
 * `actorName` is denormalised on purpose. Joining to User at read time would
 * lose the name of a staff member who has since been deleted, and "deleted
 * user changed this payment" is exactly the entry you most want to read.
 */
export function actorFromRequest(req: Request, name?: string | null): AuditActor {
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : null) ??
    req.socket.remoteAddress ??
    null;

  return {
    id: req.user?.sub ?? null,
    name: name ?? req.user?.email ?? null,
    role: req.user?.role ?? null,
    ipAddress: ip,
    userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
  };
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actor?: AuditActor | null;
}

class AuditService {
  /** Record one change. Never throws. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actorId: entry.actor?.id ?? null,
          actorName: entry.actor?.name ?? null,
          actorRole: entry.actor?.role ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: (entry.before ?? undefined) as Prisma.InputJsonValue,
          after: (entry.after ?? undefined) as Prisma.InputJsonValue,
          ipAddress: entry.actor?.ipAddress ?? null,
          userAgent: entry.actor?.userAgent ?? null,
        },
      });
    } catch (error) {
      // Deliberately swallowed — see the note at the top of this file.
      log.error(
        { err: error, action: entry.action, entityId: entry.entityId },
        'Audit write failed',
      );
    }
  }

  /**
   * Record an update, skipping no-op saves.
   *
   * A receptionist opening a member and pressing Save without typing
   * anything would otherwise fill the trail with empty entries, which is how
   * an audit log becomes something nobody reads.
   */
  async recordUpdate(params: {
    entityType: string;
    entityId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    actor?: AuditActor | null;
    action?: string;
  }): Promise<void> {
    const delta = diffRecords(params.before, params.after);
    if (!delta) return;

    await this.record({
      action: params.action ?? `${params.entityType.toUpperCase()}_UPDATED`,
      entityType: params.entityType,
      entityId: params.entityId,
      before: delta.before,
      after: delta.after,
      actor: params.actor ?? null,
    });
  }

  /** Recent entries for one record, newest first. */
  async getForEntity(
    entityType: string,
    entityId: string,
    limit = 50,
  ): Promise<unknown[]> {
    return prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const auditService = new AuditService();
