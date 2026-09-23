import {
  Role,
  paymentQuerySchema,
  recordPaymentSchema,
  refundPaymentSchema,
} from '@azf/shared';
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import { paymentsController } from './payments.controller.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  validateQuery(paymentQuerySchema),
  asyncHandler(paymentsController.list),
);

// Revenue figures are for management, not the front desk.
router.get(
  '/stats',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(paymentsController.stats),
);

router.get(
  '/defaulters',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(paymentsController.defaulters),
);

router.get('/member/:memberId/balance', asyncHandler(paymentsController.getMemberBalance));

router.get('/:id', asyncHandler(paymentsController.getById));

// Receptionists take payments at the desk.
router.post(
  '/',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(recordPaymentSchema),
  asyncHandler(paymentsController.record),
);

// Refunds move money out of the business — senior staff only.
router.post(
  '/refund',
  requireRole(Role.OWNER, Role.MANAGER),
  validateBody(refundPaymentSchema),
  asyncHandler(paymentsController.refund),
);

export { router as paymentsRoutes };
