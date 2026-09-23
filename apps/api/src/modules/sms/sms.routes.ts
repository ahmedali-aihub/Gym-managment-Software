import {
  Role,
  sendBulkSmsSchema,
  sendSmsSchema,
  smsLogQuerySchema,
} from '@azf/shared';
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import { smsController } from './sms.controller.js';

const router = Router();

router.use(authenticate);

router.get('/templates', asyncHandler(smsController.templates));
router.get('/provider', asyncHandler(smsController.providerStatus));

router.get(
  '/logs',
  validateQuery(smsLogQuerySchema),
  asyncHandler(smsController.logs),
);

router.get('/failed', asyncHandler(smsController.failedQueue));
router.get('/stats', asyncHandler(smsController.stats));

router.post(
  '/send',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(sendSmsSchema),
  asyncHandler(smsController.send),
);

// A bulk send costs real money per message — senior staff only.
router.post(
  '/send-bulk',
  requireRole(Role.OWNER, Role.MANAGER),
  validateBody(sendBulkSmsSchema),
  asyncHandler(smsController.sendBulk),
);

router.post(
  '/:id/retry',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  asyncHandler(smsController.retry),
);

router.post(
  '/retry-all',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(smsController.retryAll),
);

export { router as smsRoutes };
