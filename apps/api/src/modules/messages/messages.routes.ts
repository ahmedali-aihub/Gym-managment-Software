import { Role, cuidSchema, messageLogQuerySchema } from '@azf/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  validateParams,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import { messagesController } from './messages.controller.js';

const retryParamsSchema = z.object({
  channel: z.enum(['EMAIL', 'WHATSAPP']),
  id: cuidSchema,
});

/**
 * Unified history over email and WhatsApp — the two channels the app
 * actually sends on. See notify-dialog.tsx for why: WhatsApp reaches every
 * member (a phone number is required), email carries the receipt detail,
 * and SMS was removed from the UI entirely, so it has no place here.
 *
 * Reads only. Sending stays where it already lives — the registration flow,
 * the payment flow, and notifications.routes.ts's bulk reminder endpoint —
 * because each of those resolves its own per-member variables (an expiry
 * date, a balance) that only that call site has. Duplicating a "compose and
 * send" endpoint here would be a second way to do the same thing with its
 * own chance to drift from the first.
 */
const router = Router();

router.use(authenticate);

router.get(
  '/',
  validateQuery(messageLogQuerySchema),
  asyncHandler(messagesController.logs),
);

router.get('/failed', asyncHandler(messagesController.failedQueue));
router.get('/stats', asyncHandler(messagesController.stats));
router.get('/provider', asyncHandler(messagesController.providerStatus));

router.post(
  '/:channel/:id/retry',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateParams(retryParamsSchema),
  asyncHandler(messagesController.retry),
);

router.post(
  '/retry-all',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(messagesController.retryAll),
);

export { router as messagesRoutes };
