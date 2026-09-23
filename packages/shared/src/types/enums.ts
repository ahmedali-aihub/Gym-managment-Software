/**
 * Domain enums. These MUST stay in sync with the Prisma schema enums.
 * Declared as const objects (not TS `enum`) so they are safe to import
 * into the browser bundle and can be iterated for dropdowns.
 */

export const Role = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  TRAINER: 'TRAINER',
  RECEPTIONIST: 'RECEPTIONIST',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Ordered most- to least-privileged. Index = rank, used by the RBAC guard. */
export const ROLE_HIERARCHY: readonly Role[] = [
  Role.OWNER,
  Role.MANAGER,
  Role.TRAINER,
  Role.RECEPTIONIST,
];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  TRAINER: 'Trainer',
  RECEPTIONIST: 'Receptionist',
};

export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
};

/**
 * Lifecycle of a member's gym relationship.
 * ACTIVE   — has a running membership
 * EXPIRED  — membership end date has passed
 * FROZEN   — membership paused; remaining days are preserved
 * CANCELLED— left the gym / refunded
 */
export const MemberStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  FROZEN: 'FROZEN',
  CANCELLED: 'CANCELLED',
} as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  FROZEN: 'Frozen',
  CANCELLED: 'Cancelled',
};

export const PlanType = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  HALF_YEARLY: 'HALF_YEARLY',
  YEARLY: 'YEARLY',
  CUSTOM: 'CUSTOM',
} as const;
export type PlanType = (typeof PlanType)[keyof typeof PlanType];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-Yearly',
  YEARLY: 'Yearly',
  CUSTOM: 'Custom',
};

/** Default duration in days, used to prefill the plan form. */
export const PLAN_TYPE_DEFAULT_DAYS: Record<PlanType, number> = {
  MONTHLY: 30,
  QUARTERLY: 90,
  HALF_YEARLY: 180,
  YEARLY: 365,
  CUSTOM: 30,
};

/** Status of one member's subscription to a plan. */
export const MembershipStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  FROZEN: 'FROZEN',
  CANCELLED: 'CANCELLED',
  UPGRADED: 'UPGRADED',
  TRANSFERRED: 'TRANSFERRED',
} as const;
export type MembershipStatus =
  (typeof MembershipStatus)[keyof typeof MembershipStatus];

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  ACTIVE: 'Active',
  EXPIRED: 'Expired',
  FROZEN: 'Frozen',
  CANCELLED: 'Cancelled',
  UPGRADED: 'Upgraded',
  TRANSFERRED: 'Transferred',
};

export const PaymentMode = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
  NET_BANKING: 'NET_BANKING',
  ONLINE: 'ONLINE',
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  NET_BANKING: 'Net Banking',
  ONLINE: 'Online (Razorpay)',
};

export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  PAID: 'Paid',
  PARTIAL: 'Partially Paid',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
};

/** Why an SMS was sent — drives DLT template selection. */
export const SmsTemplateKey = {
  WELCOME: 'WELCOME',
  EXPIRY_REMINDER: 'EXPIRY_REMINDER',
  DUES_REMINDER: 'DUES_REMINDER',
  BIRTHDAY: 'BIRTHDAY',
  WINBACK: 'WINBACK',
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT',
  CUSTOM: 'CUSTOM',
} as const;
export type SmsTemplateKey =
  (typeof SmsTemplateKey)[keyof typeof SmsTemplateKey];

export const SMS_TEMPLATE_LABELS: Record<SmsTemplateKey, string> = {
  WELCOME: 'Welcome',
  EXPIRY_REMINDER: 'Expiry Reminder',
  DUES_REMINDER: 'Dues Reminder',
  BIRTHDAY: 'Birthday Wish',
  WINBACK: 'Win-back',
  PAYMENT_RECEIPT: 'Payment Receipt',
  CUSTOM: 'Custom Message',
};

/**
 * Delivery lifecycle of a single SMS.
 * QUEUED → SENDING → SENT → DELIVERED
 *                  ↘ FAILED → (retry) → SENDING
 *                           ↘ DEAD (retries exhausted; shown in failed queue)
 */
// ─── Email ──────────────────────────────────────────────────────────────────
//
// A separate channel from SMS, not a variant of it: email needs no DLT
// registration, carries attachments, and has its own delivery semantics.

export const EmailTemplateKey = {
  WELCOME: 'WELCOME',
  RECEIPT: 'RECEIPT',
  EXPIRY_REMINDER: 'EXPIRY_REMINDER',
  PAYMENT_DUE: 'PAYMENT_DUE',
} as const;
export type EmailTemplateKey =
  (typeof EmailTemplateKey)[keyof typeof EmailTemplateKey];

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  WELCOME: 'Welcome',
  RECEIPT: 'Payment Receipt',
  EXPIRY_REMINDER: 'Expiry Reminder',
  PAYMENT_DUE: 'Payment Due',
};

export const EmailStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

export const EmailProvider = {
  MOCK: 'MOCK',
  SMTP: 'SMTP',
  BREVO: 'BREVO',
  RESEND: 'RESEND',
} as const;
export type EmailProvider = (typeof EmailProvider)[keyof typeof EmailProvider];

// ─── WhatsApp ───────────────────────────────────────────────────────────────
//
// A separate channel again: WhatsApp needs Meta template approval rather than
// DLT, reports a READ receipt that SMS and email cannot, and is the channel
// most Indian gym members actually check.

export const WhatsAppTemplateKey = {
  WELCOME: 'WELCOME',
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT',
  EXPIRY_REMINDER: 'EXPIRY_REMINDER',
  PAYMENT_DUE: 'PAYMENT_DUE',
} as const;
export type WhatsAppTemplateKey =
  (typeof WhatsAppTemplateKey)[keyof typeof WhatsAppTemplateKey];

export const WHATSAPP_TEMPLATE_LABELS: Record<WhatsAppTemplateKey, string> = {
  WELCOME: 'Welcome',
  PAYMENT_RECEIPT: 'Payment Receipt',
  EXPIRY_REMINDER: 'Expiry Reminder',
  PAYMENT_DUE: 'Payment Due',
};

export const WhatsAppStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type WhatsAppStatus =
  (typeof WhatsAppStatus)[keyof typeof WhatsAppStatus];

export const WhatsAppProvider = {
  MOCK: 'MOCK',
  META: 'META',
} as const;
export type WhatsAppProvider =
  (typeof WhatsAppProvider)[keyof typeof WhatsAppProvider];

export const SmsStatus = {
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
} as const;
export type SmsStatus = (typeof SmsStatus)[keyof typeof SmsStatus];

export const SMS_STATUS_LABELS: Record<SmsStatus, string> = {
  QUEUED: 'Queued',
  SENDING: 'Sending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  FAILED: 'Failed',
  DEAD: 'Failed (retries exhausted)',
};

export const SmsProvider = {
  MOCK: 'MOCK',
  MSG91: 'MSG91',
  TWILIO: 'TWILIO',
  FAST2SMS: 'FAST2SMS',
} as const;
export type SmsProvider = (typeof SmsProvider)[keyof typeof SmsProvider];

/** How a membership period ended or changed — for the audit trail. */
export const MembershipEventType = {
  CREATED: 'CREATED',
  RENEWED: 'RENEWED',
  FROZEN: 'FROZEN',
  UNFROZEN: 'UNFROZEN',
  UPGRADED: 'UPGRADED',
  TRANSFERRED_OUT: 'TRANSFERRED_OUT',
  TRANSFERRED_IN: 'TRANSFERRED_IN',
  CANCELLED: 'CANCELLED',
} as const;
export type MembershipEventType =
  (typeof MembershipEventType)[keyof typeof MembershipEventType];

export const MEMBERSHIP_EVENT_LABELS: Record<MembershipEventType, string> = {
  CREATED: 'Created',
  RENEWED: 'Renewed',
  FROZEN: 'Frozen',
  UNFROZEN: 'Unfrozen',
  UPGRADED: 'Upgraded',
  TRANSFERRED_OUT: 'Transferred out',
  TRANSFERRED_IN: 'Transferred in',
  CANCELLED: 'Cancelled',
};
