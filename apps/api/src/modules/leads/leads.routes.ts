import { Role } from '@azf/shared';
import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate,
  requireRole,
  requireUser,
} from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import { leadsService } from './leads.service.js';

const router = Router();

router.use(authenticate);

const STATUSES = [
  'NEW',
  'CONTACTED',
  'TRIAL_SCHEDULED',
  'TRIAL_DONE',
  'NEGOTIATING',
  'CONVERTED',
  'LOST',
] as const;

const SOURCES = [
  'WALK_IN',
  'PHONE',
  'REFERRAL',
  'INSTAGRAM',
  'FACEBOOK',
  'GOOGLE',
  'WHATSAPP',
  'FLYER',
  'OTHER',
] as const;

const createSchema = z.object({
  fullName: z.string().trim().min(2, 'Name is required').max(100),
  phone: z
    .string()
    .trim()
    .regex(/^(?:\+?91|0)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number')
    .transform((value) => value.replace(/\D/g, '').slice(-10)),
  email: z.union([z.literal(''), z.string().email()]).optional(),
  source: z.enum(SOURCES).default('WALK_IN'),
  interestedIn: z.string().trim().max(200).optional(),
  quotedPlanId: z.string().cuid().optional(),
  notes: z.string().trim().max(1000).optional(),
  followUpAt: z.coerce.date().optional(),
  assignedToId: z.string().cuid().optional(),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  source: z.enum(SOURCES).optional(),
  dueOnly: z.coerce.boolean().optional(),
});

const statusSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(500).optional(),
  followUpAt: z.coerce.date().optional(),
  lostReason: z.string().trim().max(300).optional(),
});

const activitySchema = z.object({
  type: z.enum(['CALL', 'VISIT', 'SMS', 'WHATSAPP', 'NOTE']),
  summary: z.string().trim().min(2, 'Describe what happened').max(500),
  followUpAt: z.coerce.date().optional(),
});

router.get(
  '/',
  validateQuery(querySchema),
  asyncHandler(async (req, res) => {
    const result = await leadsService.list(
      req.query as unknown as z.infer<typeof querySchema>,
    );
    res.json({ success: true, ...result });
  }),
);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const data = await leadsService.getStats();
    res.json({ success: true, data });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = await leadsService.getById(req.params.id as string);
    res.json({ success: true, data: lead });
  }),
);

// Receptionists take enquiries at the desk — that is the whole point.
router.post(
  '/',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const actor = requireUser(req);
    const lead = await leadsService.create(
      req.body as z.infer<typeof createSchema>,
      actor.sub,
    );
    res.status(201).json({ success: true, data: lead });
  }),
);

router.post(
  '/:id/status',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(statusSchema),
  asyncHandler(async (req, res) => {
    const actor = requireUser(req);
    const body = req.body as z.infer<typeof statusSchema>;

    const lead = await leadsService.updateStatus(
      req.params.id as string,
      body.status,
      {
        note: body.note,
        followUpAt: body.followUpAt,
        lostReason: body.lostReason,
        actorId: actor.sub,
      },
    );

    res.json({ success: true, data: lead });
  }),
);

router.post(
  '/:id/activity',
  requireRole(Role.OWNER, Role.MANAGER, Role.RECEPTIONIST),
  validateBody(activitySchema),
  asyncHandler(async (req, res) => {
    const actor = requireUser(req);
    const activity = await leadsService.addActivity(
      req.params.id as string,
      req.body as z.infer<typeof activitySchema>,
      actor.sub,
    );
    res.status(201).json({ success: true, data: activity });
  }),
);

router.delete(
  '/:id',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(async (req, res) => {
    await leadsService.remove(req.params.id as string);
    res.json({ success: true, data: { message: 'Lead removed' } });
  }),
);

export { router as leadsRoutes };
