import type {
  CreateMemberPayload,
  MemberQuery,
  UpdateMemberInput,
} from '@azf/shared';
import type { Request, Response } from 'express';
import { ConflictError } from '../../lib/errors.js';
import { requireUser } from '../../middleware/auth.middleware.js';
import {
  actorFromRequest,
  auditService,
} from '../../services/audit/audit.service.js';
import { membersService } from './members.service.js';

export const membersController = {
  async register(req: Request, res: Response): Promise<void> {
    const actor = requireUser(req);
    const input = req.body as CreateMemberPayload;

    // Families share phone numbers, so this is a warning rather than a hard
    // block — but registering the same person twice is a common desk mistake,
    // and the client can confirm with ?allowDuplicatePhone=true.
    if (req.query.allowDuplicatePhone !== 'true') {
      const duplicate = await membersService.checkDuplicatePhone(input.phone);
      if (duplicate) {
        throw new ConflictError(
          `${duplicate.fullName} (${duplicate.memberId}) is already registered with this number. Resubmit with allowDuplicatePhone=true to continue.`,
          'DUPLICATE_ENTRY',
        );
      }
    }

    const result = await membersService.register(
      input,
      actor.sub,
      actorFromRequest(req),
    );

    res.status(201).json({
      success: true,
      data: { member: result.member, qrDataUrl: result.qrDataUrl },
    });
  },

  async list(req: Request, res: Response): Promise<void> {
    const result = await membersService.list(req.query as unknown as MemberQuery);
    res.json({ success: true, ...result });
  },

  async stats(_req: Request, res: Response): Promise<void> {
    const stats = await membersService.getStats();
    res.json({ success: true, data: stats });
  },

  async getProfile(req: Request, res: Response): Promise<void> {
    const profile = await membersService.getProfile(req.params.id as string);
    res.json({ success: true, data: profile });
  },

  async history(req: Request, res: Response): Promise<void> {
    const entries = await auditService.getForEntity(
      'Member',
      req.params.id as string,
    );
    res.json({ success: true, data: entries });
  },

  async getByMemberId(req: Request, res: Response): Promise<void> {
    const member = await membersService.getByMemberId(
      req.params.memberId as string,
    );
    res.json({ success: true, data: member });
  },

  async update(req: Request, res: Response): Promise<void> {
    const member = await membersService.update(
      req.params.id as string,
      req.body as UpdateMemberInput,
      actorFromRequest(req),
    );
    res.json({ success: true, data: member });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await membersService.remove(
      req.params.id as string,
      actorFromRequest(req),
    );
    res.json({ success: true, data: { message: 'Member removed' } });
  },

  async rotateQr(req: Request, res: Response): Promise<void> {
    const result = await membersService.rotateQrToken(
      req.params.id as string,
      actorFromRequest(req),
    );
    res.json({ success: true, data: result });
  },
};
