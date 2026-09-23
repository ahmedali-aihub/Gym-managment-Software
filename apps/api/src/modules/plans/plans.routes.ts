import {
  Role,
  createPlanSchema,
  freezeMembershipSchema,
  planQuerySchema,
  renewMembershipSchema,
  transferMembershipSchema,
  updatePlanSchema,
  upgradeMembershipSchema,
} from '@azf/shared';
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import { membershipsController, plansController } from './plans.controller.js';

const router = Router();

router.use(authenticate);

// ── Plans ────────────────────────────────────────────────────────────────
router.get('/', validateQuery(planQuerySchema), asyncHandler(plansController.list));

/** Unpaginated list for the registration dropdown. */
router.get('/active', asyncHandler(plansController.listActive));

router.get('/distribution', asyncHandler(plansController.distribution));

router.get('/:id', asyncHandler(plansController.getById));

// Pricing is an owner/manager decision.
router.post(
  '/',
  requireRole(Role.OWNER, Role.MANAGER),
  validateBody(createPlanSchema),
  asyncHandler(plansController.create),
);

router.patch(
  '/:id',
  requireRole(Role.OWNER, Role.MANAGER),
  validateBody(updatePlanSchema),
  asyncHandler(plansController.update),
);

router.delete(
  '/:id',
  requireRole(Role.OWNER),
  asyncHandler(plansController.retire),
);

export { router as plansRoutes };

// ── Memberships ──────────────────────────────────────────────────────────
const membershipRouter = Router();
membershipRouter.use(authenticate);

membershipRouter.get('/expiring', asyncHandler(membershipsController.expiring));

membershipRouter.post(
  '/freeze',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(freezeMembershipSchema),
  asyncHandler(membershipsController.freeze),
);

membershipRouter.post(
  '/:id/unfreeze',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  asyncHandler(membershipsController.unfreeze),
);

/** Quote first, charge second — same code path for both. */
membershipRouter.post(
  '/upgrade/preview',
  validateBody(upgradeMembershipSchema),
  asyncHandler(membershipsController.previewUpgrade),
);

membershipRouter.post(
  '/upgrade',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(upgradeMembershipSchema),
  asyncHandler(membershipsController.upgrade),
);

// Transfers move paid-for value between people — senior staff only.
membershipRouter.post(
  '/transfer',
  requireRole(Role.OWNER, Role.MANAGER),
  validateBody(transferMembershipSchema),
  asyncHandler(membershipsController.transfer),
);

membershipRouter.post(
  '/renew',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(renewMembershipSchema),
  asyncHandler(membershipsController.renew),
);

export { membershipRouter as membershipsRoutes };
