import { z } from 'zod';
import { paginationSchema } from './common.schema.js';

/**
 * The unified Messages view: one timeline over email and WhatsApp together.
 *
 * The two channels keep separate tables — EmailLog and WhatsAppLog have
 * genuinely different fields (WhatsApp has READ receipts, email has
 * attachments) and separate status enums, so forcing one Prisma model would
 * either lose fields or carry nulls that mean "not applicable" on every
 * row. Unifying happens at the API boundary instead: each row here is
 * normalized from whichever table it came from, tagged with `channel`, and
 * merged by createdAt. SMS is deliberately left out — it has no UI entry
 * point (see notify-dialog.tsx), and a "message" the owner cannot have sent
 * has no place in a sent-message history.
 */

export const MessageChannel = {
  EMAIL: 'EMAIL',
  WHATSAPP: 'WHATSAPP',
} as const;
export type MessageChannel = (typeof MessageChannel)[keyof typeof MessageChannel];

/**
 * One delivery status vocabulary across both channels, so the UI has one
 * badge set instead of two. WhatsApp's READ collapses into DELIVERED here —
 * the Messages list is "did it get sent", not a read-receipt tracker — and
 * the underlying WhatsAppStatus (still READ) is kept on the row for anyone
 * who needs the distinction.
 */
export const MessageStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  QUEUED: 'Queued',
  SENDING: 'Sending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  DEAD: 'Failed (retries exhausted)',
};

/** A normalized row, whichever table it was read from. */
export interface MessageLogRow {
  id: string;
  channel: MessageChannel;
  to: string;
  templateKey: string;
  templateLabel: string;
  /** Subject for email, the rendered body's first line for WhatsApp. */
  preview: string;
  status: MessageStatus;
  /** The channel's own, more specific status — e.g. WhatsApp's READ. */
  nativeStatus: string;
  provider: string;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  sentAt: string | null;
  member: { id: string; memberId: string; fullName: string } | null;
}

export const messageLogQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  channel: z.enum(['email', 'whatsapp', 'all']).default('all'),
  status: z.nativeEnum(MessageStatus).optional(),
  memberId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type MessageLogQuery = z.infer<typeof messageLogQuerySchema>;

export interface MessageStats {
  total: number;
  emailTotal: number;
  whatsappTotal: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  dead: number;
  deliveryRate: number;
}
