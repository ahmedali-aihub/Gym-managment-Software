import { z } from 'zod';
import { WhatsAppTemplateKey } from '../types/enums.js';

/**
 * WhatsApp templates.
 *
 * Meta requires every business-initiated message to match a template it has
 * APPROVED in advance, the same way Indian SMS requires a DLT-registered
 * template. The body here mirrors the submitted text with {{1}}, {{2}}
 * placeholders in the same positions — Meta numbers its variables rather
 * than naming them, and a mismatch is rejected outright.
 *
 * `variables` names each numbered slot in order, so callers pass a readable
 * object and the adapter turns it into Meta's positional array. Getting the
 * ORDER wrong swaps a member's name with their plan and the message still
 * sends, so the order here is the contract.
 *
 * Submit these to Meta Business Manager → WhatsApp Manager → Message
 * Templates, category UTILITY (not MARKETING — utility templates are
 * cheaper and are not rate-limited per user).
 */

export interface WhatsAppTemplateDefinition {
  key: WhatsAppTemplateKey;
  label: string;
  /** The name registered with Meta. Lower snake_case is Meta's convention. */
  metaName: string;
  /** Body text with {{1}}-style placeholders, exactly as submitted. */
  body: string;
  /** Names for {{1}}, {{2}}, … IN ORDER. */
  variables: readonly string[];
  description: string;
}

export const WHATSAPP_TEMPLATES: Record<
  WhatsAppTemplateKey,
  WhatsAppTemplateDefinition
> = {
  WELCOME: {
    key: WhatsAppTemplateKey.WELCOME,
    label: 'Welcome',
    metaName: 'azf_welcome',
    body:
      'Welcome to {{1}}, {{2}}! Your member ID is {{3}}. Plan: {{4}}, valid until {{5}}. Amount paid: Rs. {{6}}. Questions? Call {{7}}',
    variables: [
      'gymName',
      'name',
      'memberId',
      'plan',
      'expiryDate',
      'amount',
      'gymPhone',
    ],
    description: 'Sent when a member is registered.',
  },

  PAYMENT_RECEIPT: {
    key: WhatsAppTemplateKey.PAYMENT_RECEIPT,
    label: 'Payment Receipt',
    metaName: 'azf_payment_receipt',
    body:
      'Payment received, {{1}}. Rs. {{2}} on {{3}} via {{4}}. Receipt {{5}}. Balance due: Rs. {{6}}. — {{7}}',
    variables: [
      'name',
      'amount',
      'paidDate',
      'mode',
      'receiptNo',
      'balance',
      'gymName',
    ],
    description: 'Sent when a payment is recorded.',
  },

  EXPIRY_REMINDER: {
    key: WhatsAppTemplateKey.EXPIRY_REMINDER,
    label: 'Expiry Reminder',
    metaName: 'azf_expiry_reminder',
    body:
      'Hi {{1}}, your {{2}} membership ({{3}}) expires on {{4}}. Renew to keep training without a break. Call {{5}}',
    variables: ['name', 'gymName', 'memberId', 'expiryDate', 'gymPhone'],
    description: 'Sent before a membership lapses.',
  },

  PAYMENT_DUE: {
    key: WhatsAppTemplateKey.PAYMENT_DUE,
    label: 'Payment Due',
    metaName: 'azf_payment_due',
    body:
      'Hi {{1}}, your account {{2}} has a pending balance of Rs. {{3}}. Please settle it on your next visit. — {{4}}, {{5}}',
    variables: ['name', 'memberId', 'amount', 'gymName', 'gymPhone'],
    description: 'Sent to members carrying dues.',
  },
};

/**
 * Turn a named variable object into Meta's positional array.
 *
 * Meta sends `[{type:'text', text:'...'}, …]` in template order, so a
 * missing value must still occupy its slot — dropping it shifts every later
 * variable up by one and the message sends with a member's plan where their
 * name should be. An empty string holds the position.
 */
export function toWhatsAppParameters(
  template: WhatsAppTemplateDefinition,
  variables: Record<string, string | number>,
): string[] {
  return template.variables.map((name) => {
    const value = variables[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Render the body locally, for logging and for the mock provider. */
export function renderWhatsAppTemplate(
  template: WhatsAppTemplateDefinition,
  variables: Record<string, string | number>,
): string {
  const parameters = toWhatsAppParameters(template, variables);
  return template.body.replace(/\{\{(\d+)\}\}/g, (match, index: string) => {
    const value = parameters[Number(index) - 1];
    return value === undefined ? match : value;
  });
}

export const sendWhatsAppSchema = z.object({
  to: z.string().min(1),
  templateKey: z.nativeEnum(WhatsAppTemplateKey),
  memberId: z.string().optional(),
  variables: z.record(z.union([z.string(), z.number()])).default({}),
});

export type SendWhatsAppInput = z.infer<typeof sendWhatsAppSchema>;
