import type {
  AuthTokens,
  AuthUser,
  ChangePasswordInput,
  CreateUserInput,
  LoginInput,
  LoginResponse,
} from '@azf/shared';
import { normalizePhone } from '@azf/shared';
import type { User } from '@prisma/client';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  accessTokenExpirySeconds,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyPassword,
} from './auth.utils.js';

const log = moduleLogger('auth');

export interface RequestContext {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

class AuthService {
  /**
   * Authenticate staff by email or phone.
   *
   * Failures are deliberately indistinguishable: a wrong password, an unknown
   * account and a deactivated account all return the same message. Anything
   * more specific is an account-enumeration oracle.
   */
  async login(
    input: LoginInput,
    context: RequestContext = {},
  ): Promise<LoginResponse> {
    const identifier = input.identifier.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: identifier }, { phone: normalizePhone(identifier) }],
      },
    });

    // Hash against a dummy even when no user exists, so response time does not
    // reveal whether the account is real.
    if (!user) {
      await verifyPassword(
        input.password,
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      );
      throw new UnauthorizedError(
        'Incorrect email/phone or password',
        'INVALID_CREDENTIALS',
      );
    }

    const passwordValid = await verifyPassword(input.password, user.passwordHash);

    if (!passwordValid) {
      log.warn({ userId: user.id }, 'Failed login attempt');
      throw new UnauthorizedError(
        'Incorrect email/phone or password',
        'INVALID_CREDENTIALS',
      );
    }

    if (!user.isActive) {
      log.warn({ userId: user.id }, 'Login attempt on deactivated account');
      throw new UnauthorizedError(
        'Incorrect email/phone or password',
        'INVALID_CREDENTIALS',
      );
    }

    const tokens = await this.issueTokens(user, context);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    log.info({ userId: user.id, role: user.role }, 'User logged in');

    return { user: toAuthUser(user), tokens };
  }

  /**
   * Exchange a refresh token for a new pair, rotating the old one.
   *
   * Rotation plus reuse detection: each token records its successor when used.
   * Presenting an already-rotated token means it leaked — the legitimate
   * holder has a newer one — so the whole family is revoked immediately.
   */
  async refresh(
    refreshToken: string,
    context: RequestContext = {},
  ): Promise<AuthTokens> {
    const tokenHash = hashRefreshToken(refreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedError('Invalid refresh token', 'TOKEN_INVALID');
    }

    if (stored.revokedAt) {
      // A revoked token being presented means it was captured. Assume the
      // worst and invalidate every session this user holds.
      log.error(
        { userId: stored.userId, tokenId: stored.id },
        'Refresh token reuse detected — revoking all sessions',
      );
      await this.revokeAllSessions(stored.userId);
      throw new UnauthorizedError(
        'Session invalidated. Please sign in again.',
        'TOKEN_INVALID',
      );
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedError('Session expired', 'TOKEN_EXPIRED');
    }

    if (!stored.user.isActive || stored.user.deletedAt) {
      throw new UnauthorizedError('Account is no longer active', 'FORBIDDEN');
    }

    const tokens = await this.issueTokens(stored.user, context);

    // Mark the old token spent and point it at its replacement.
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        replacedBy: hashRefreshToken(tokens.refreshToken),
      },
    });

    return tokens;
  }

  /** Revoke one session. Idempotent — logging out twice is not an error. */
  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);

    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
  ): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    const valid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError(
        'Current password is incorrect',
        'INVALID_CREDENTIALS',
      );
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(input.newPassword),
          // Invalidates every live access token without a blocklist.
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    log.info({ userId }, 'Password changed; all sessions revoked');
  }

  /** Create a staff account. Owner/Manager only — enforced at the route. */
  async createUser(input: CreateUserInput): Promise<AuthUser> {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: input.email }, { phone: input.phone }],
      },
    });

    if (existing) {
      const field = existing.email === input.email ? 'email' : 'phone number';
      throw new ConflictError(
        `A staff account with this ${field} already exists`,
        'DUPLICATE_ENTRY',
      );
    }

    const user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash: await hashPassword(input.password),
        role: input.role,
        isActive: input.isActive,
      },
    });

    log.info({ userId: user.id, role: user.role }, 'Staff account created');

    return toAuthUser(user);
  }

  async getCurrentUser(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundError('User');
    return toAuthUser(user);
  }

  /**
   * Deactivate a staff account and cut its sessions.
   * The row is kept so past actions remain attributable.
   */
  async deactivateUser(userId: string, actorId: string): Promise<void> {
    if (userId === actorId) {
      throw new ForbiddenError('You cannot deactivate your own account');
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    // Losing the last owner would leave the system unadministrable.
    if (user.role === 'OWNER') {
      const owners = await prisma.user.count({
        where: { role: 'OWNER', isActive: true, deletedAt: null },
      });
      if (owners <= 1) {
        throw new ForbiddenError('The last owner account cannot be deactivated');
      }
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { isActive: false, tokenVersion: { increment: 1 } },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    log.info({ userId, actorId }, 'Staff account deactivated');
  }

  /** Housekeeping: drop tokens that expired or were revoked long ago. */
  async pruneExpiredTokens(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
      },
    });

    return result.count;
  }

  private async issueTokens(
    user: User,
    context: RequestContext,
  ): Promise<AuthTokens> {
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      email: user.email,
      tokenVersion: user.tokenVersion,
    });

    const refreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshTokenExpiry(),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTokenExpirySeconds(),
    };
  }
}

/** Strip the password hash and internal fields before leaving the server. */
function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    avatarUrl: user.avatarUrl,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export const authService = new AuthService();
