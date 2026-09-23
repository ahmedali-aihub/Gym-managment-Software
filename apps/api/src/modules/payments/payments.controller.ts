import type {
  PaymentQuery,
  RecordPaymentPayload,
  RefundPaymentInput,
} from '@azf/shared';
import type { Request, Response } from 'express';
import { requireUser } from '../../middleware/auth.middleware.js';
import { paymentsService } from './payments.service.js';

export const paymentsController = {
  async record(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const result = await paymentsService.record(
      req.body as RecordPaymentPayload,
      actor.sub,
    );

    res.status(201).json({
      success: true,
      data: { payment: result.payment, balance: result.balance },
    });
  },

  async list(req: Request, res: Response): Promise<void> {
    const result = await paymentsService.list(
      req.query as unknown as PaymentQuery,
    );
    res.json({ success: true, ...result });
  },

  async stats(req: Request, res: Response): Promise<void> {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const stats = await paymentsService.getStats(from, to);
    res.json({ success: true, data: stats });
  },

  async getById(req: Request, res: Response): Promise<void> {
    const payment = await paymentsService.getById(req.params.id as string);
    res.json({ success: true, data: payment });
  },

  async getMemberBalance(req: Request, res: Response): Promise<void> {
    const balance = await paymentsService.getMemberBalance(
      req.params.memberId as string,
    );
    res.json({ success: true, data: balance });
  },

  async refund(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const payment = await paymentsService.refund(
      req.body as RefundPaymentInput,
      actor.sub,
    );
    res.json({ success: true, data: payment });
  },

  async defaulters(req: Request, res: Response): Promise<void> {
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const defaulters = await paymentsService.getDefaulters(limit);
    res.json({ success: true, data: defaulters });
  },
};
