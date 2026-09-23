import {
  Role,
  createMemberSchema,
  memberQuerySchema,
  updateMemberSchema,
} from '@azf/shared';
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import { membersController } from './members.controller.js';

const router = Router();

// Every member route requires a signed-in staff member.
router.use(authenticate);

router.get(
  '/',
  validateQuery(memberQuerySchema),
  asyncHandler(membersController.list),
);

router.get('/stats', asyncHandler(membersController.stats));

/** Front-desk lookup by the printed AZF-YYYY-NNNN code. */
router.get('/code/:memberId', asyncHandler(membersController.getByMemberId));

router.get('/:id', asyncHandler(membersController.getProfile));

/**
 * Change history for one member.
 *
 * Owner and manager only. The trail records who edited a membership or a
 * phone number, which is management information rather than something the
 * front desk needs while serving a queue.
 */
router.get(
  '/:id/history',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(membersController.history),
);

// Receptionists register members — it is their core job.
router.post(
  '/',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(createMemberSchema),
  asyncHandler(membersController.register),
);

router.patch(
  '/:id',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(updateMemberSchema),
  asyncHandler(membersController.update),
);

router.post(
  '/:id/rotate-qr',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  asyncHandler(membersController.rotateQr),
);

// Removal is destructive and stays with senior staff.
router.delete(
  '/:id',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(membersController.remove),
);

export { router as membersRoutes };
