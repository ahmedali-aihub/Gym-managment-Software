import { z } from 'zod';
import {
  INDIAN_MOBILE_PATTERN,
  PINCODE_PATTERN,
  normalizePhone,
} from '../constants/identifiers.js';
import { MAX_TRANSACTION_PAISE } from '../constants/money.js';

/**
 * Reusable field-level schemas. Composed into the entity schemas so a rule
 * like "what counts as a valid phone number" is written exactly once.
 */

/** Indian mobile. Transforms to bare 10 digits so storage is consistent. */
export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .refine((v) => INDIAN_MOBILE_PATTERN.test(v), {
    message: 'Enter a valid 10-digit Indian mobile number',
  })
  .transform(normalizePhone);

export const optionalPhoneSchema = z
  .union([z.literal(''), phoneSchema])
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address');

export const optionalEmailSchema = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Must be at least 2 characters')
  .max(100, 'Must be under 100 characters')
  // Indian names legitimately contain spaces, dots (S. Kumar), apostrophes
  // (D'Souza) and hyphens. Digits are always a typo.
  .regex(/^[a-zA-Z\s.'-]+$/, 'Only letters, spaces, dots and hyphens allowed');

export const pincodeSchema = z
  .string()
  .trim()
  .regex(PINCODE_PATTERN, 'Enter a valid 6-digit PIN code');

export const optionalPincodeSchema = z
  .union([z.literal(''), pincodeSchema])
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/**
 * Money, in paise. Integer only — see constants/money.ts for why.
 * Rejects negatives and absurd values that indicate a data-entry slip.
 */
export const paiseSchema = z
  .number({ invalid_type_error: 'Enter a valid amount' })
  .int('Amount must be a whole number of paise')
  .min(0, 'Amount cannot be negative')
  .max(MAX_TRANSACTION_PAISE, 'Amount exceeds the maximum allowed');

/** Strictly positive money — for payments, which cannot be zero. */
export const positivePaiseSchema = paiseSchema.refine((v) => v > 0, {
  message: 'Amount must be greater than zero',
});

/** Accepts an ISO string or Date, always yields a Date. */
export const dateSchema = z.coerce.date({
  invalid_type_error: 'Enter a valid date',
});

/** Date of birth: must be in the past and imply an age of 10–100. */
export const dobSchema = dateSchema
  .refine((d) => d < new Date(), { message: 'Date of birth must be in the past' })
  .refine(
    (d) => {
      const age = new Date().getFullYear() - d.getFullYear();
      return age >= 10 && age <= 100;
    },
    { message: 'Member must be between 10 and 100 years old' },
  );

export const cuidSchema = z.string().cuid('Invalid identifier');

/** Standard pagination query. Every list endpoint accepts these. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;

/** Shape every paginated response follows. */
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export const addressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).default('Hyderabad'),
  state: z.string().trim().max(100).default('Telangana'),
  pincode: optionalPincodeSchema,
});

export type Address = z.infer<typeof addressSchema>;

export const emergencyContactSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  relation: z.string().trim().min(2).max(50),
});

export type EmergencyContact = z.infer<typeof emergencyContactSchema>;
