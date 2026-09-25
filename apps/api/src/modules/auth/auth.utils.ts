import { createHash, randomBytes } from 'node:crypto';
import type { JwtPayload, Role } from '@azf/shared';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../lib/errors.js';

/**
 * Password hashing and token handling.
 *
 * Kept separate from the service so it can be unit-tested without a database,
 * and so the cryptographic choices sit in one reviewable place.
 */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface AccessTokenClaims {
  sub: string;
  role: Role;
  email: string;
  tokenVersion: number;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: 'azf-api',
    audience: 'azf-web',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      // Pinned rather than left to whatever the token claims. jsonwebtoken
      // verifies against the algorithm the TOKEN says it used unless told
      // otherwise — harmless with a plain string secret today, but only
      // because nothing here is an RSA/EC public key. Pinning removes that
      // assumption as a thing that has to stay true forever.
      algorithms: ['HS256'],
      issuer: 'azf-api',
      audience: 'azf-web',
    }) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // Distinguished from a malformed token so the client knows to refresh
      // rather than bouncing the user to the login screen.
      throw new UnauthorizedError('Session expired', 'TOKEN_EXPIRED');
    }
    throw new UnauthorizedError('Invalid token', 'TOKEN_INVALID');
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs.
 *
 * A JWT refresh token cannot be revoked without a blocklist, which defeats the
 * point. An opaque token is a lookup key: revoking it is a database write, and
 * the token carries no readable claims if intercepted.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * Stored hashed, so a database leak cannot be replayed as a live session.
 *
 * SHA-256 rather than bcrypt is correct here: the token is already 48 bytes of
 * cryptographic randomness, so there is no low-entropy secret to slow down
 * guessing against — and refresh happens on every page load, where bcrypt's
 * deliberate slowness would be a real latency cost.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parse "15m" / "30d" / "12h" into milliseconds. */
export function parseDuration(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = Number(match[1]);
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[match[2]] ?? 0);
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + parseDuration(env.JWT_REFRESH_EXPIRES_IN));
}

export function accessTokenExpirySeconds(): number {
  return Math.floor(parseDuration(env.JWT_ACCESS_EXPIRES_IN) / 1000);
}

/** Pull a bearer token out of an Authorization header. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}
