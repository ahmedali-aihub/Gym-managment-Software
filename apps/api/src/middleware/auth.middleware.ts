import type { JwtPayload, Role } from '@azf/shared';
import { ROLE_HIERARCHY } from '@azf/shared';
import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import {
  extractBearerToken,
  verifyAccessToken,
} from '../modules/auth/auth.utils.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Verify the bearer token and attach its claims to the request.
 *
 * The token's `tokenVersion` is checked against the database on every request.
 * That costs one indexed lookup, and it is what makes "log out everywhere" and
 * account deactivation take effect immediately rather than whenever the access
 * token happens to expire.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      throw new UnauthorizedError('Authentication required');
    }

    const claims = verifyAccessToken(token);

    const user = await prisma.user.findFirst({
      where: { id: claims.sub, deletedAt: null },
      select: { id: true, isActive: true, tokenVersion: true, role: true },
    });

    if (!user) {
      throw new UnauthorizedError('Account no longer exists', 'TOKEN_INVALID');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account has been deactivated', 'FORBIDDEN');
    }

    if (user.tokenVersion !== claims.tokenVersion) {
      throw new UnauthorizedError(
        'Session invalidated. Please sign in again.',
        'TOKEN_INVALID',
      );
    }

    // Trust the database for the role, not the token: a demotion must take
    // effect immediately, not at token expiry.
    req.user = { ...claims, role: user.role };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Restrict a route to specific roles.
 *
 * Roles are checked by explicit membership, not by hierarchy rank — a Trainer
 * is not "below" a Receptionist in any meaningful sense; they simply do
 * different jobs. Where seniority genuinely applies, use requireMinimumRole.
 *
 * @example router.post('/', authenticate, requireRole('OWNER', 'MANAGER'), handler)
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    if (!allowed.includes(req.user.role)) {
      next(
        new ForbiddenError(
          'Your role does not have permission to perform this action',
        ),
      );
      return;
    }

    next();
  };
}

/** Allow this role and anything more senior. OWNER passes everything. */
export function requireMinimumRole(minimum: Role) {
  const threshold = ROLE_HIERARCHY.indexOf(minimum);

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const rank = ROLE_HIERARCHY.indexOf(req.user.role);

    // Lower index = more senior.
    if (rank === -1 || rank > threshold) {
      next(
        new ForbiddenError(
          'Your role does not have permission to perform this action',
        ),
      );
      return;
    }

    next();
  };
}

/**
 * Attach user claims when a token is present, but allow the request through
 * without one. For endpoints whose response varies by viewer.
 */
export async function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    next();
    return;
  }

  try {
    req.user = verifyAccessToken(token);
  } catch {
    // An invalid token on an optional route is treated as no token.
  }

  next();
}

/** Narrow `req.user` for handlers that run after `authenticate`. */
export function requireUser(req: Request): JwtPayload {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }
  return req.user;
}
