import { z } from 'zod';
import { Role } from '../types/enums.js';
import { emailSchema, nameSchema, phoneSchema } from './common.schema.js';

/**
 * Password policy: long enough to resist offline cracking, with a mix
 * requirement, but no forced rotation or exotic symbol rules — those push staff
 * toward writing passwords on a sticky note at the front desk.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[a-z]/, 'Include at least one lowercase letter')
  .regex(/[A-Z]/, 'Include at least one uppercase letter')
  .regex(/\d/, 'Include at least one number');

export const loginSchema = z.object({
  /** Staff sign in with email or phone — whichever they remember. */
  identifier: z.string().trim().min(1, 'Email or phone is required'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const createUserSchema = z.object({
  fullName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  role: z.nativeEnum(Role),
  isActive: z.boolean().default(true),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema
  .partial()
  .omit({ password: true });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Claims embedded in the access token. Kept minimal — it is not a cache. */
export interface JwtPayload {
  sub: string;
  role: Role;
  email: string;
  /** Rotated on password change / forced logout to invalidate live tokens. */
  tokenVersion: number;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  isActive: boolean;
  avatarUrl: string | null;
  lastLoginAt: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
}
