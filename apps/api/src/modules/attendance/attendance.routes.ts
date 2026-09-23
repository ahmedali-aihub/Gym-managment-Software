import { Role } from '@azf/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { requireUser } from '../../middleware/auth.middleware.js';
import { attendanceService } from './attendance.service.js';

const router = Router();

router.use(authenticate);

const checkInSchema = z
  .object({
    /** Raw QR payload: AZF:MEMBER:<memberId>:<token> */
    qrPayload: z.string().trim().min(1).optional(),
    /** Printed member ID, for a forgotten or damaged pass. */
    memberId: z.string().trim().min(1).optional(),
  })
  .refine((input) => Boolean(input.qrPayload ?? input.memberId), {
    message: 'Provide either a QR payload or a member ID',
  });

/**
 * Check a member in.
 *
 * Receptionists do this all day, so it is deliberately open to them as well
 * as management — it is the single most-used endpoint in the system.
 */
router.post(
  '/check-in',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(checkInSchema),
  asyncHandler(async (req, res) => {
    const actor = requireUser(req);
    const { qrPayload, memberId } = req.body as z.infer<typeof checkInSchema>;

    const result = qrPayload
      ? await attendanceService.checkInByQr(qrPayload, actor.sub)
      : await attendanceService.checkInByMemberId(memberId!, actor.sub);

    res.status(201).json({ success: true, data: result });
  }),
);

router.post(
  '/:id/check-out',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  asyncHandler(async (req, res) => {
    const result = await attendanceService.checkOut(req.params.id as string);
    res.json({ success: true, data: result });
  }),
);

/** Who is in the gym right now. */
router.get(
  '/current',
  asyncHandler(async (_req, res) => {
    const data = await attendanceService.getCurrentlyIn();
    res.json({ success: true, data });
  }),
);

router.get(
  '/today',
  asyncHandler(async (_req, res) => {
    const data = await attendanceService.getTodayStats();
    res.json({ success: true, data });
  }),
);

export { router as attendanceRoutes };
