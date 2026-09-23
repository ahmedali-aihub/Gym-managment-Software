import { Role } from '@azf/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, requireUser } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import {
  notificationsService,
  type NotificationChannel,
  type NotificationKind,
} from './notifications.service.js';

const router = Router();

router.use(authenticate);
router.use(requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST));

const sendRemindersSchema = z.object({
  memberIds: z.array(z.string()).min(1).max(500),
  kind: z.enum(['EXPIRY_REMINDER', 'PAYMENT_DUE']),
  // At least one channel, or the request is a no-op the caller would read
  // as success.
  channels: z
    .array(z.enum(['whatsapp', 'email', 'sms']))
    .min(1, 'Choose at least one channel'),
});

/**
 * Send a reminder to selected members.
 *
 * Capped at 500 members per request: beyond that the request outlives a
 * reasonable HTTP timeout, and the owner has no feedback on what actually
 * went out. The UI sends in pages rather than one call.
 */
router.post(
  '/reminders',
  validateBody(sendRemindersSchema),
  asyncHandler(async (req, res) => {
    const actor = requireUser(req);
    const input = req.body as {
      memberIds: string[];
      kind: NotificationKind;
      channels: NotificationChannel[];
    };

    const result = await notificationsService.sendReminders({
      memberIds: input.memberIds,
      kind: input.kind,
      channels: input.channels,
      sentById: actor.sub,
    });

    res.json({ success: true, data: result });
  }),
);

export { router as notificationsRoutes };
