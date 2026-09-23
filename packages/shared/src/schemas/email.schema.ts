import { z } from 'zod';
import { EmailTemplateKey } from '../types/enums.js';

/**
 * Email templates.
 *
 * Unlike SMS, email needs no DLT registration and no per-message approval —
 * the body here is the whole contract, and changing it takes effect at once.
 *
 * WRITTEN AS INLINE-STYLED TABLES, deliberately. Gmail strips <style> blocks
 * and ignores most modern CSS, so a stylesheet that looks right in a browser
 * arrives as unstyled text. Tables with inline styles are the only layout
 * that survives Gmail, Outlook and the Indian webmail clients alike.
 *
 * Every template also carries a plain-text alternative. Some clients render
 * only that, and a text part measurably improves spam scoring.
 */

export interface EmailTemplateDefinition {
  key: EmailTemplateKey;
  label: string;
  subject: string;
  /** HTML body with {{variables}}. */
  body: string;
  /** Plain-text fallback with the same {{variables}}. */
  text: string;
  variables: readonly string[];
  description: string;
}

/** Natural Titanium, inlined — the email cannot read the app's CSS. */
const INK = '#2b2926';
const MUTED = '#6f6963';
const BRONZE = '#96631f';
const SURFACE = '#faf8f5';
const BORDER = '#e7e1d8';

/**
 * Shared shell.
 *
 * `max-width: 560px` with `width: 100%` is the combination that renders on
 * both a phone and a desktop client; a fixed pixel width overflows on mobile
 * Gmail, and a percentage alone stretches to unreadable line lengths.
 */
function shell(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{gymName}}</title>
</head>
<body style="margin:0;padding:0;background-color:${SURFACE};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${SURFACE};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
${inner}
<tr><td style="padding:20px 28px;border-top:1px solid ${BORDER};background-color:${SURFACE};">
<p style="margin:0;font-size:12px;line-height:18px;color:${MUTED};">
{{gymName}} · {{gymAddress}}<br>
Call {{gymPhone}} · {{gymEmail}}
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function header(title: string): string {
  return `<tr><td style="padding:28px 28px 8px;">
<p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${BRONZE};">{{gymName}}</p>
<h1 style="margin:0;font-size:22px;line-height:30px;font-weight:700;color:${INK};">${title}</h1>
</td></tr>`;
}

/** A label/value row in the details table. */
function row(label: string, value: string, strong = false): string {
  return `<tr>
<td style="padding:8px 0;font-size:14px;color:${MUTED};">${label}</td>
<td style="padding:8px 0;font-size:14px;text-align:right;color:${INK};${strong ? 'font-weight:700;' : ''}">${value}</td>
</tr>`;
}

export const EMAIL_TEMPLATES: Record<
  EmailTemplateKey,
  EmailTemplateDefinition
> = {
  WELCOME: {
    key: EmailTemplateKey.WELCOME,
    label: 'Welcome',
    subject: 'Welcome to {{gymName}}, {{name}}!',
    body: shell(
      `${header('Welcome aboard, {{name}}')}
<tr><td style="padding:4px 28px 0;">
<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:${INK};">
Your membership is active. Here are your details — keep this email, your member ID is your reference for everything.
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};margin-bottom:20px;">
${row('Member ID', '{{memberId}}', true)}
${row('Plan', '{{plan}}')}
${row('Starts', '{{startDate}}')}
${row('Valid until', '{{expiryDate}}', true)}
${row('Amount paid', 'Rs. {{amount}}')}
</table>
<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:${INK};">
Your receipt is attached to this email as a PDF.
</p>
<p style="margin:0 0 24px;font-size:14px;line-height:22px;color:${MUTED};">
Bring your member ID on your first visit and the front desk will get you set up. Any questions, just call us on {{gymPhone}}.
</p>
</td></tr>`,
    ),
    text: `Welcome to {{gymName}}, {{name}}!

Your membership is active.

Member ID:    {{memberId}}
Plan:         {{plan}}
Starts:       {{startDate}}
Valid until:  {{expiryDate}}
Amount paid:  Rs. {{amount}}

Your receipt is attached as a PDF.

Bring your member ID on your first visit. Questions? Call {{gymPhone}}.

{{gymName}}
{{gymAddress}}
{{gymPhone}}`,
    variables: [
      'name',
      'memberId',
      'plan',
      'startDate',
      'expiryDate',
      'amount',
      'gymName',
      'gymAddress',
      'gymPhone',
      'gymEmail',
    ],
    description: 'Sent automatically when a member is registered.',
  },

  RECEIPT: {
    key: EmailTemplateKey.RECEIPT,
    label: 'Payment Receipt',
    subject: 'Receipt {{receiptNo}} — {{gymName}}',
    body: shell(
      `${header('Payment received')}
<tr><td style="padding:4px 28px 0;">
<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:${INK};">
Hi {{name}}, we have received your payment. The receipt is attached.
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};margin-bottom:20px;">
${row('Receipt no.', '{{receiptNo}}')}
${row('Member ID', '{{memberId}}')}
${row('Paid on', '{{paidDate}}')}
${row('Method', '{{mode}}')}
${row('Amount', 'Rs. {{amount}}', true)}
${row('Balance due', 'Rs. {{balance}}')}
</table>
<p style="margin:0 0 24px;font-size:14px;line-height:22px;color:${MUTED};">
Questions about this payment? Call us on {{gymPhone}}.
</p>
</td></tr>`,
    ),
    text: `Payment received — {{gymName}}

Hi {{name}}, we have received your payment.

Receipt no.:  {{receiptNo}}
Member ID:    {{memberId}}
Paid on:      {{paidDate}}
Method:       {{mode}}
Amount:       Rs. {{amount}}
Balance due:  Rs. {{balance}}

The receipt is attached as a PDF.

{{gymName}} · {{gymPhone}}`,
    variables: [
      'name',
      'memberId',
      'receiptNo',
      'paidDate',
      'mode',
      'amount',
      'balance',
      'gymName',
      'gymAddress',
      'gymPhone',
      'gymEmail',
    ],
    description: 'Sent when a payment is recorded.',
  },

  EXPIRY_REMINDER: {
    key: EmailTemplateKey.EXPIRY_REMINDER,
    label: 'Expiry Reminder',
    subject: 'Your membership expires on {{expiryDate}}',
    body: shell(
      `${header('Time to renew, {{name}}')}
<tr><td style="padding:4px 28px 0;">
<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:${INK};">
Your membership ({{memberId}}) expires on <strong>{{expiryDate}}</strong> — that is {{days}} days away.
</p>
<p style="margin:0 0 24px;font-size:14px;line-height:22px;color:${MUTED};">
Renew at the front desk or call {{gymPhone}} and we will sort it out over the phone.
</p>
</td></tr>`,
    ),
    text: `Time to renew, {{name}}

Your membership ({{memberId}}) expires on {{expiryDate}} — {{days}} days away.

Renew at the front desk or call {{gymPhone}}.

{{gymName}} · {{gymPhone}}`,
    variables: [
      'name',
      'memberId',
      'expiryDate',
      'days',
      'gymName',
      'gymAddress',
      'gymPhone',
      'gymEmail',
    ],
    description: 'Sent before a membership lapses.',
  },

  PAYMENT_DUE: {
    key: EmailTemplateKey.PAYMENT_DUE,
    label: 'Payment Due',
    subject: 'Pending balance — {{gymName}}',
    body: shell(
      `${header('A balance is pending')}
<tr><td style="padding:4px 28px 0;">
<p style="margin:0 0 20px;font-size:15px;line-height:23px;color:${INK};">
Hi {{name}}, your account ({{memberId}}) has an outstanding balance of <strong>Rs. {{amount}}</strong>.
</p>
<p style="margin:0 0 24px;font-size:14px;line-height:22px;color:${MUTED};">
You can settle it at the front desk on your next visit, or call {{gymPhone}}.
</p>
</td></tr>`,
    ),
    text: `Pending balance — {{gymName}}

Hi {{name}}, your account ({{memberId}}) has an outstanding balance of Rs. {{amount}}.

Settle it at the front desk or call {{gymPhone}}.

{{gymName}} · {{gymPhone}}`,
    variables: [
      'name',
      'memberId',
      'amount',
      'gymName',
      'gymAddress',
      'gymPhone',
      'gymEmail',
    ],
    description: 'Sent to members carrying dues.',
  },
};

/**
 * Substitute {{variables}}.
 *
 * Values are HTML-escaped: a member called "A & B" would otherwise break the
 * markup, and an unescaped value is an injection route into anything the
 * template renders.
 */
export function renderEmailTemplate(
  template: string,
  variables: Record<string, string | number>,
  escape = true,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = variables[key];
    if (value === undefined) return match;

    const asString = String(value);
    if (!escape) return asString;

    return asString
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  });
}

export const sendEmailSchema = z.object({
  to: z.string().email(),
  templateKey: z.nativeEnum(EmailTemplateKey),
  memberId: z.string().optional(),
  variables: z.record(z.union([z.string(), z.number()])).default({}),
  /** Invoice whose receipt PDF to attach, if any. */
  attachInvoiceId: z.string().optional(),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;
