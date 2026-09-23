import { Role } from '@azf/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, requireUser } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware.js';
import { expensesService } from './expenses.service.js';

const router = Router();

router.use(authenticate);

// Expenses reveal the gym's cost base and margin — owner and manager only.
router.use(requireRole(Role.OWNER, Role.MANAGER));

const CATEGORIES = [
  'RENT',
  'SALARIES',
  'ELECTRICITY',
  'WATER',
  'EQUIPMENT',
  'MAINTENANCE',
  'MARKETING',
  'SUPPLIES',
  'INTERNET',
  'INSURANCE',
  'TAXES',
  'OTHER',
] as const;

const expenseSchema = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(2, 'Describe what this was for').max(120),
  notes: z.string().trim().max(500).optional(),
  amountPaise: z
    .number()
    .int('Amount must be a whole number of paise')
    .positive('Amount must be greater than zero'),
  incurredAt: z.coerce.date(),
  paymentMode: z
    .enum(['CASH', 'UPI', 'CARD', 'NET_BANKING', 'ONLINE'])
    .default('CASH'),
  reference: z.string().trim().max(100).optional(),
  paidTo: z.string().trim().max(120).optional(),
  isRecurring: z.boolean().default(false),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get(
  '/',
  validateQuery(querySchema),
  asyncHandler(async (req, res) => {
    const result = await expensesService.list(
      req.query as unknown as z.infer<typeof querySchema>,
    );
    res.json({ success: true, ...result });
  }),
);

/**
 * Profit and loss.
 *
 * Defaults to the current Indian financial year, which is the window an
 * owner's accountant works in.
 */
router.get(
  '/profit-loss',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const fyStart =
      now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

    const from = req.query.from
      ? new Date(String(req.query.from))
      : new Date(fyStart, 3, 1);
    const to = req.query.to ? new Date(String(req.query.to)) : now;

    const data = await expensesService.getProfitAndLoss(from, to);
    res.json({ success: true, data });
  }),
);

router.post(
  '/',
  validateBody(expenseSchema),
  asyncHandler(async (req, res) => {
    const actor = requireUser(req);
    const expense = await expensesService.create(
      req.body as z.infer<typeof expenseSchema>,
      actor.sub,
    );
    res.status(201).json({ success: true, data: expense });
  }),
);

/** Copy last month's fixed costs into the current month. */
router.post(
  '/roll-forward',
  asyncHandler(async (req, res) => {
    const actor = requireUser(req);
    const month = req.body?.month ? new Date(String(req.body.month)) : new Date();

    const result = await expensesService.rollForwardRecurring(month, actor.sub);
    res.json({ success: true, data: result });
  }),
);

router.patch(
  '/:id',
  validateBody(expenseSchema.partial()),
  asyncHandler(async (req, res) => {
    const expense = await expensesService.update(
      req.params.id as string,
      req.body as Partial<z.infer<typeof expenseSchema>>,
    );
    res.json({ success: true, data: expense });
  }),
);

router.delete(
  '/:id',
  requireRole(Role.OWNER),
  asyncHandler(async (req, res) => {
    await expensesService.remove(req.params.id as string);
    res.json({ success: true, data: { message: 'Expense removed' } });
  }),
);

export { router as expensesRoutes };
