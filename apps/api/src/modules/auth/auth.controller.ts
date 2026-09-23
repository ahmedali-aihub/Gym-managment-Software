import type {
  ChangePasswordInput,
  CreateUserInput,
  LoginInput,
} from '@azf/shared';
import type { Request, Response } from 'express';
import { isProduction } from '../../config/env.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { requireUser } from '../../middleware/auth.middleware.js';
import { authService, type RequestContext } from './auth.service.js';
import { parseDuration } from './auth.utils.js';

/**
 * Auth HTTP layer.
 *
 * The refresh token travels in an httpOnly cookie rather than the response
 * body: JavaScript cannot read it, which removes the most common XSS token
 * theft path. The short-lived access token stays in memory on the client.
 */

const REFRESH_COOKIE = 'azf_refresh';

function refreshCookieOptions() {
  // 'lax' throughout, because the app and the API deploy to ONE host: the
  // web app is served from /, the API from /api, so a refresh is never a
  // cross-site request. 'lax' blocks the cross-site POSTs that CSRF relies
  // on, which 'none' would permit — so the single-host deployment buys back
  // the stronger cookie policy for free.
  //
  // Splitting the two across hosts again would need 'none' plus secure.
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/api/auth',
    maxAge: parseDuration(process.env.JWT_REFRESH_EXPIRES_IN ?? '30d'),
  };
}

function contextFrom(req: Request): RequestContext {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(
      req.body as LoginInput,
      contextFrom(req),
    );

    res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, refreshCookieOptions());

    res.json({
      success: true,
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
        expiresIn: result.tokens.expiresIn,
      },
    });
  },

  async refresh(req: Request, res: Response): Promise<void> {
    // Accept the cookie first; the body fallback supports non-browser clients
    // such as the future mobile PWA.
    const token =
      (req.cookies?.[REFRESH_COOKIE] as string | undefined) ??
      (req.body?.refreshToken as string | undefined);

    if (!token) {
      throw new UnauthorizedError('No refresh token provided', 'TOKEN_INVALID');
    }

    const tokens = await authService.refresh(token, contextFrom(req));

    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());

    res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
      },
    });
  },

  async logout(req: Request, res: Response): Promise<void> {
    const token =
      (req.cookies?.[REFRESH_COOKIE] as string | undefined) ??
      (req.body?.refreshToken as string | undefined);

    if (token) await authService.logout(token);

    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({ success: true, data: { message: 'Signed out' } });
  },

  async logoutAll(req: Request, res: Response): Promise<void> {
    const user = requireUser(req);
    await authService.revokeAllSessions(user.sub);

    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({
      success: true,
      data: { message: 'Signed out of all devices' },
    });
  },

  async me(req: Request, res: Response): Promise<void> {
    const user = requireUser(req);
    const profile = await authService.getCurrentUser(user.sub);
    res.json({ success: true, data: profile });
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    const user = requireUser(req);
    await authService.changePassword(user.sub, req.body as ChangePasswordInput);

    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.json({
      success: true,
      data: {
        message: 'Password changed. Please sign in again.',
      },
    });
  },

  async createUser(req: Request, res: Response): Promise<void> {
    const created = await authService.createUser(req.body as CreateUserInput);
    res.status(201).json({ success: true, data: created });
  },

  async deactivateUser(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    await authService.deactivateUser(req.params.id as string, actor.sub);
    res.json({ success: true, data: { message: 'Account deactivated' } });
  },
};
