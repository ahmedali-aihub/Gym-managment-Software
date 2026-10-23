import type {
  CreatePlanInput,
  FreezeMembershipInput,
  RenewMembershipInput,
  TransferMembershipInput,
  UpdatePlanInput,
  UpgradeMembershipInput,
} from '@azf/shared';
import type { Request, Response } from 'express';
import { requireUser } from '../../middleware/auth.middleware.js';
import { membershipsService } from './memberships.service.js';
import { plansService, type PlanQueryParams } from './plans.service.js';

export const plansController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await plansService.list(
      req.query as unknown as PlanQueryParams,
    );
    res.json({ success: true, ...result });
  },

  async listActive(_req: Request, res: Response): Promise<void> {
    const plans = await plansService.listActive();
    res.json({ success: true, data: plans });
  },

  async getById(req: Request, res: Response): Promise<void> {
    const plan = await plansService.getById(req.params.id as string);
    res.json({ success: true, data: plan });
  },

  async create(req: Request, res: Response): Promise<void> {
    const plan = await plansService.create(req.body as CreatePlanInput);
    res.status(201).json({ success: true, data: plan });
  },

  async update(req: Request, res: Response): Promise<void> {
    const plan = await plansService.update(
      req.params.id as string,
      req.body as UpdatePlanInput,
    );
    res.json({ success: true, data: plan });
  },

  async retire(req: Request, res: Response): Promise<void> {
    await plansService.retire(req.params.id as string);
    res.json({
      success: true,
      data: {
        message: 'Plan retired. Existing memberships are unaffected.',
      },
    });
  },

  async distribution(_req: Request, res: Response): Promise<void> {
    const distribution = await plansService.getDistribution();
    res.json({ success: true, data: distribution });
  },
};

export const membershipsController = {
  async freeze(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const membership = await membershipsService.freeze(
      req.body as FreezeMembershipInput,
      actor.sub,
    );
    res.json({ success: true, data: membership });
  },

  async unfreeze(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const resumeDate = req.body?.resumeDate
      ? new Date(req.body.resumeDate as string)
      : new Date();

    const membership = await membershipsService.unfreeze(
      req.params.id as string,
      resumeDate,
      actor.sub,
    );
    res.json({ success: true, data: membership });
  },

  /** Quote an upgrade before taking money for it. */
  async previewUpgrade(req: Request, res: Response): Promise<void> {
    const preview = await membershipsService.previewUpgrade(
      req.body as UpgradeMembershipInput,
    );
    res.json({ success: true, data: preview });
  },

  async upgrade(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const membership = await membershipsService.upgrade(
      req.body as UpgradeMembershipInput,
      actor.sub,
    );
    res.status(201).json({ success: true, data: membership });
  },

  async transfer(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const membership = await membershipsService.transfer(
      req.body as TransferMembershipInput,
      actor.sub,
    );
    res.status(201).json({ success: true, data: membership });
  },

  async renew(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const membership = await membershipsService.renew(
      req.body as RenewMembershipInput,
      actor.sub,
    );
    res.status(201).json({ success: true, data: membership });
  },

  async expiring(req: Request, res: Response): Promise<void> {
    const days = Math.min(Number(req.query.days) || 7, 365);
    const expiring = await membershipsService.getExpiring(days);
    res.json({ success: true, data: expiring });
  },
};
