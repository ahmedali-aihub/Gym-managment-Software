import { z } from 'zod';
import { SmsProvider, SmsStatus, SmsTemplateKey } from '../types/enums.js';
import { cuidSchema, paginationSchema, phoneSchema } from './common.schema.js';

/**
 * SMS templates.
 *
 * In India, transactional SMS must match a DLT-approved template registered
 * with the telecom regulator. The body here mirrors that approved text, with
 * {{variables}} in the same positions. Sending text that deviates from the
 * registered template gets the message silently dropped by the operator —
 * so `body` is the contract, not a suggestion.
 *
 * Keep each under 160 GSM-7 characters to stay a single billed segment.
 */
export interface SmsTemplateDefinition {
  key: SmsTemplateKey;
  label: string;
  body: string;
  variables: readonly string[];
  description: string;
}

export const SMS_TEMPLATES: Record<SmsTemplateKey, SmsTemplateDefinition> = {
  WELCOME: {
    key: 'WELCOME',
    label: 'Welcome',
    body:
      'Welcome to A to Z Fitness, {{name}}! Your ID: {{memberId}}. Plan: {{plan}} ({{startDate}} to {{expiryDate}}). Paid: Rs.{{amount}}. Queries: {{gymPhone}}',
    variables: [
      'name',
      'memberId',
      'plan',
      'startDate',
      'expiryDate',
      'amount',
      'gymPhone',
    ],
    description: 'Sent immediately after a member is registered.',
  },
  EXPIRY_REMINDER: {
    key: 'EXPIRY_REMINDER',
    label: 'Expiry Reminder',
    body:
      'Hi {{name}}, your A to Z Fitness membership ({{memberId}}) expires on {{expiryDate}}. Renew now to keep training. Call {{gymPhone}}',
    variables: ['name', 'memberId', 'expiryDate', 'gymPhone'],
    description: 'Sent before a membership lapses.',
  },
  DUES_REMINDER: {
    key: 'DUES_REMINDER',
    label: 'Dues Reminder',
    body:
      'Hi {{name}}, a balance of Rs.{{amount}} is pending on your A to Z Fitness membership ({{memberId}}). Please clear it at the front desk. {{gymPhone}}',
    variables: ['name', 'memberId', 'amount', 'gymPhone'],
    description: 'Sent to members with an outstanding balance.',
  },
  BIRTHDAY: {
    key: 'BIRTHDAY',
    label: 'Birthday Wish',
    body:
      'Happy Birthday {{name}}! Wishing you a strong and healthy year ahead. - Team A to Z Fitness',
    variables: ['name'],
    description: 'Sent on a member’s birthday.',
  },
  WINBACK: {
    key: 'WINBACK',
    label: 'Win-back',
    body:
      'Hi {{name}}, we have missed you at A to Z Fitness for {{days}} days. Come back and pick up where you left off. {{gymPhone}}',
    variables: ['name', 'days', 'gymPhone'],
    description: 'Sent to active members who have stopped visiting.',
  },
  PAYMENT_RECEIPT: {
    key: 'PAYMENT_RECEIPT',
    label: 'Payment Receipt',
    body:
      'Payment received: Rs.{{amount}} on {{date}} for {{memberId}} at A to Z Fitness. Balance: Rs.{{balance}}. Receipt: {{receiptNo}}',
    variables: ['amount', 'date', 'memberId', 'balance', 'receiptNo'],
    description: 'Sent when a payment is recorded.',
  },
  CUSTOM: {
    key: 'CUSTOM',
    label: 'Custom Message',
    body: '{{message}}',
    variables: ['message'],
    description: 'Free-text message. Requires its own DLT approval to send.',
  },
};

/** Fill {{placeholders}} from a variable map. Unknown keys are left intact. */
export function renderSmsTemplate(
  body: string,
  variables: Record<string, string | number>,
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}

/** Return the {{names}} a template body references. */
export function extractTemplateVariables(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{(\w+)\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/**
 * GSM-7 is the 7-bit alphabet operators bill single-segment SMS in. A single
 * character outside it (a curly quote, an emoji, the ₹ sign) flips the whole
 * message to UCS-2 and cuts the segment size from 160 to 70 characters.
 */
const GSM7_CHARSET =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = '^{}\\[~]|€';

export function isGsm7(text: string): boolean {
  return [...text].every(
    (ch) => GSM7_CHARSET.includes(ch) || GSM7_EXTENDED.includes(ch),
  );
}

/** Billable segment count, so the UI can warn before a costly broadcast. */
export function countSmsSegments(text: string): {
  encoding: 'GSM-7' | 'UCS-2';
  length: number;
  segments: number;
} {
  const gsm7 = isGsm7(text);
  // Extended-set characters occupy two septets each.
  const length = gsm7
    ? [...text].reduce(
        (sum, ch) => sum + (GSM7_EXTENDED.includes(ch) ? 2 : 1),
        0,
      )
    : text.length;

  const singleLimit = gsm7 ? 160 : 70;
  const multiLimit = gsm7 ? 153 : 67;
  const segments =
    length <= singleLimit ? 1 : Math.ceil(length / multiLimit);

  return { encoding: gsm7 ? 'GSM-7' : 'UCS-2', length, segments };
}

export const sendSmsSchema = z.object({
  to: phoneSchema,
  templateKey: z.nativeEnum(SmsTemplateKey),
  variables: z.record(z.union([z.string(), z.number()])).default({}),
  memberId: cuidSchema.optional(),
  /** Skip the queue and attempt delivery immediately. */
  immediate: z.boolean().default(true),
});

export type SendSmsInput = z.infer<typeof sendSmsSchema>;

/** Send one template to many members — the "remind everyone expiring" action. */
export const sendBulkSmsSchema = z.object({
  memberIds: z
    .array(cuidSchema)
    .min(1, 'Select at least one member')
    .max(500, 'Send to at most 500 members at a time'),
  templateKey: z.nativeEnum(SmsTemplateKey),
  variables: z.record(z.union([z.string(), z.number()])).default({}),
});

export type SendBulkSmsInput = z.infer<typeof sendBulkSmsSchema>;

export const smsLogQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.nativeEnum(SmsStatus).optional(),
  templateKey: z.nativeEnum(SmsTemplateKey).optional(),
  provider: z.nativeEnum(SmsProvider).optional(),
  memberId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type SmsLogQuery = z.infer<typeof smsLogQuerySchema>;

/** What every provider adapter returns, whatever its wire format. */
export interface SmsSendResult {
  success: boolean;
  providerMessageId: string | null;
  status: SmsStatus;
  errorCode: string | null;
  errorMessage: string | null;
  /** Raw provider response, kept verbatim for support escalations. */
  rawResponse: unknown;
  segments: number;
}

export interface SmsStats {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  dead: number;
  deliveryRate: number;
  segmentsUsed: number;
}
