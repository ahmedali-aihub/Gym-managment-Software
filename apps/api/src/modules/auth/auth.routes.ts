import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  Role,
} from '@azf/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { authController } from './auth.controller.js';

const router = Router();

/**
 * Login is rate-limited far more aggressively than the rest of the API.
 * Without it, the login endpoint is an offline-speed password oracle.
 * Keyed by IP + identifier so one attacker cannot lock out a whole gym by
 * exhausting the shared front-desk IP's quota.
 */
const loginLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const identifier =
      typeof req.body?.identifier === 'string'
        ? req.body.identifier.toLowerCase()
        : 'unknown';
    return `${req.ip}:${identifier}`;
  },
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many sign-in attempts. Please try again later.',
    },
  },
});

// ── Public ───────────────────────────────────────────────────────────────
router.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(authController.login),
);

router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));

// ── Authenticated ────────────────────────────────────────────────────────
router.get('/me', authenticate, asyncHandler(authController.me));

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(authController.logoutAll),
);

router.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  asyncHandler(authController.changePassword),
);

// ── Staff administration (Owner/Manager only) ────────────────────────────
router.post(
  '/users',
  authenticate,
  requireRole(Role.OWNER, Role.MANAGER),
  validateBody(createUserSchema),
  asyncHandler(authController.createUser),
);

router.delete(
  '/users/:id',
  authenticate,
  requireRole(Role.OWNER),
  asyncHandler(authController.deactivateUser),
);

export { router as authRoutes };
