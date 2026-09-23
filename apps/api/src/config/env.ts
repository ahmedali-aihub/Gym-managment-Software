import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the monorepo root so both apps read one file.
loadDotenv({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * Environment contract.
 *
 * Validated once at boot. A missing JWT secret should stop the process on
 * startup, not surface as a 500 the first time someone tries to log in.
 */
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    API_BASE_URL: z.string().url().default('http://localhost:4000'),
    WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DIRECT_URL: z.string().optional(),

    // Auth
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    // Gym identity
    GYM_NAME: z.string().default('A to Z Fitness'),
    GYM_ADDRESS_LINE1: z.string().default('Mehdipatnam'),
    GYM_ADDRESS_LINE2: z.string().default('Hyderabad, Telangana 500028'),
    GYM_PHONE: z.string().default('+91 00000 00000'),
    GYM_EMAIL: z.string().default('info@atozfitness.in'),
    GYM_STATE_CODE: z.coerce.number().int().default(36),

    // Tax
    GST_REGISTERED: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    GSTIN: z.string().optional(),
    GST_RATE: z.coerce.number().int().min(0).max(28).default(18),
    GST_SAC_CODE: z.string().default('999723'),
    PRICES_INCLUDE_TAX: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),

    // SMS
    SMS_PROVIDER: z
      .enum(['mock', 'msg91', 'twilio', 'fast2sms'])
      .default('mock'),
    SMS_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    SMS_SENDER_ID: z.string().default('AZFITS'),
    SMS_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    SMS_RETRY_BACKOFF_MS: z.coerce.number().int().min(1000).default(60_000),

    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_WELCOME: z.string().optional(),
    MSG91_TEMPLATE_EXPIRY: z.string().optional(),
    MSG91_TEMPLATE_DUES: z.string().optional(),
    MSG91_TEMPLATE_BIRTHDAY: z.string().optional(),
    MSG91_TEMPLATE_WINBACK: z.string().optional(),
    DLT_ENTITY_ID: z.string().optional(),

    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM_NUMBER: z.string().optional(),

    FAST2SMS_API_KEY: z.string().optional(),

    // Email
    //
    // Unlike SMS, email needs no DLT registration, so this channel works the
    // day credentials are set. 'smtp' covers Gmail: an App Password, not the
    // account password — Google rejects the latter for SMTP.
    EMAIL_PROVIDER: z.enum(['mock', 'smtp', 'brevo', 'resend']).default('mock'),
    EMAIL_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    /// What members see as the sender name, e.g. "A to Z Fitness".
    EMAIL_FROM_NAME: z.string().default('A to Z Fitness'),
    // An empty value in .env is "not configured", not "invalid". Without the
    // preprocess an unfilled EMAIL_FROM_ADDRESS= line fails validation and
    // blocks server startup entirely — a channel nobody has set up yet must
    // never stop the gym opening.
    EMAIL_FROM_ADDRESS: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().email().optional(),
    ),
    /// Where member replies land; defaults to EMAIL_FROM_ADDRESS.
    EMAIL_REPLY_TO: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().email().optional(),
    ),
    EMAIL_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    EMAIL_RETRY_BACKOFF_MS: z.coerce.number().int().min(1000).default(60_000),

    SMTP_HOST: z.string().default('smtp.gmail.com'),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: z
      .string()
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_USER: z.string().optional(),
    /// A Gmail App Password (16 chars, generated at myaccount.google.com).
    SMTP_PASSWORD: z.string().optional(),

    BREVO_API_KEY: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    // WhatsApp
    //
    // Meta requires business verification and per-template approval before
    // anything sends, so 'mock' remains the default until that completes.
    WHATSAPP_PROVIDER: z.enum(['mock', 'meta']).default('mock'),
    WHATSAPP_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v === 'true'),
    WHATSAPP_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
    WHATSAPP_RETRY_BACKOFF_MS: z.coerce.number().int().min(1000).default(60_000),
    /// BCP-47 code of the APPROVED template, not the member's language.
    WHATSAPP_LANGUAGE: z.string().default('en'),
    WHATSAPP_API_VERSION: z.string().default('v21.0'),
    /// From Meta: WhatsApp Manager -> API Setup.
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),

    // Payments
    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    // Uploads
    UPLOAD_DIR: z.string().default('./uploads'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().default(5_242_880),

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(900_000),
    RATE_LIMIT_MAX: z.coerce.number().int().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(10),
  })
  // Selecting a real provider without its credentials would fail silently at
  // send time — catch it at boot instead.
  .refine((e) => e.SMS_PROVIDER !== 'msg91' || Boolean(e.MSG91_AUTH_KEY), {
    message: 'MSG91_AUTH_KEY is required when SMS_PROVIDER=msg91',
    path: ['MSG91_AUTH_KEY'],
  })
  .refine(
    (e) =>
      e.EMAIL_PROVIDER !== 'smtp' ||
      (Boolean(e.SMTP_USER) && Boolean(e.SMTP_PASSWORD)),
    {
      message:
        'SMTP_USER and SMTP_PASSWORD are required when EMAIL_PROVIDER=smtp (Gmail needs an App Password, not your account password)',
      path: ['SMTP_PASSWORD'],
    },
  )
  .refine(
    (e) =>
      e.WHATSAPP_PROVIDER !== 'meta' ||
      (Boolean(e.WHATSAPP_ACCESS_TOKEN) &&
        Boolean(e.WHATSAPP_PHONE_NUMBER_ID)),
    {
      message:
        'WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WHATSAPP_PROVIDER=meta',
      path: ['WHATSAPP_ACCESS_TOKEN'],
    },
  )
  .refine(
    (e) => e.EMAIL_PROVIDER === 'mock' || Boolean(e.EMAIL_FROM_ADDRESS),
    {
      message: 'EMAIL_FROM_ADDRESS is required unless EMAIL_PROVIDER=mock',
      path: ['EMAIL_FROM_ADDRESS'],
    },
  )
  .refine(
    (e) =>
      e.SMS_PROVIDER !== 'twilio' ||
      Boolean(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM_NUMBER),
    {
      message:
        'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are required when SMS_PROVIDER=twilio',
      path: ['TWILIO_ACCOUNT_SID'],
    },
  )
  .refine((e) => e.SMS_PROVIDER !== 'fast2sms' || Boolean(e.FAST2SMS_API_KEY), {
    message: 'FAST2SMS_API_KEY is required when SMS_PROVIDER=fast2sms',
    path: ['FAST2SMS_API_KEY'],
  })
  .refine(
    (e) =>
      e.PAYMENT_PROVIDER !== 'razorpay' ||
      Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET),
    {
      message:
        'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when PAYMENT_PROVIDER=razorpay',
      path: ['RAZORPAY_KEY_ID'],
    },
  )
  .refine((e) => !e.GST_REGISTERED || Boolean(e.GSTIN), {
    message: 'GSTIN is required when GST_REGISTERED=true',
    path: ['GSTIN'],
  })
  .refine((e) => e.JWT_ACCESS_SECRET !== e.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ',
    path: ['JWT_REFRESH_SECRET'],
  });

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');

    console.error(
      `\n╭─ Invalid environment configuration ─────────────────────────\n` +
        `${issues}\n` +
        `╰─ Copy .env.example to .env and fill in the values.\n`,
    );
    process.exit(1);
  }

  return result.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * Email channel.
 *
 * `from` falls back to the gym's own address so a half-configured setup still
 * sends something sensible rather than throwing at send time.
 */
export const emailConfig = {
  provider: env.EMAIL_PROVIDER,
  enabled: env.EMAIL_ENABLED,
  fromName: env.EMAIL_FROM_NAME,
  fromAddress: env.EMAIL_FROM_ADDRESS ?? env.GYM_EMAIL,
  replyTo: env.EMAIL_REPLY_TO ?? env.EMAIL_FROM_ADDRESS ?? env.GYM_EMAIL,
  maxRetries: env.EMAIL_MAX_RETRIES,
  retryBackoffMs: env.EMAIL_RETRY_BACKOFF_MS,
} as const;

/**
 * WhatsApp channel.
 *
 * Kept beside emailConfig so a caller never has to know which env vars back
 * which channel.
 */
export const whatsappConfig = {
  provider: env.WHATSAPP_PROVIDER,
  enabled: env.WHATSAPP_ENABLED,
  maxRetries: env.WHATSAPP_MAX_RETRIES,
  retryBackoffMs: env.WHATSAPP_RETRY_BACKOFF_MS,
  languageCode: env.WHATSAPP_LANGUAGE,
} as const;

/** Gym identity, as printed on receipts. */
export const gymConfig = {
  name: env.GYM_NAME,
  addressLine1: env.GYM_ADDRESS_LINE1,
  addressLine2: env.GYM_ADDRESS_LINE2,
  phone: env.GYM_PHONE,
  email: env.GYM_EMAIL,
  stateCode: env.GYM_STATE_CODE,
} as const;

/**
 * Tax configuration.
 *
 * A to Z Fitness is currently below the ₹20L GST threshold, so documents are
 * issued as plain receipts. Flip GST_REGISTERED to true and add a GSTIN to
 * start issuing tax invoices — no code change required.
 */
export const taxConfig = {
  isRegistered: env.GST_REGISTERED,
  gstin: env.GSTIN ?? null,
  rate: env.GST_REGISTERED ? env.GST_RATE : 0,
  sacCode: env.GST_SAC_CODE,
  pricesIncludeTax: env.PRICES_INCLUDE_TAX,
} as const;
