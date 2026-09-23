import type {
  CreatePlanInput,
  PaginatedResponse,
  UpdatePlanInput,
} from '@azf/shared';
import type { Plan, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { moduleLogger } from '../../lib/logger.js';
import {
  buildOrderBy,
  buildPaginatedResponse,
  getSkipTake,
} from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';

const log = moduleLogger('plans');

const SORTABLE_FIELDS = [
  'name',
  'pricePaise',
  'durationDays',
  'sortOrder',
  'createdAt',
] as const;

export interface PlanQueryParams {
  page: number;
  limit: number;
  sortBy?: string | undefined;
  sortOrder: 'asc' | 'desc';
  search?: string | undefined;
  type?: string | undefined;
  isActive?: boolean | undefined;
}

class PlansService {
  async list(params: PlanQueryParams): Promise<PaginatedResponse<Plan>> {
    const { skip, take } = getSkipTake(params);

    const where: Prisma.PlanWhereInput = {
      deletedAt: null,
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
      ...(params.type ? { type: params.type as Plan['type'] } : {}),
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: 'insensitive' } },
              { description: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.plan.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(
          params.sortBy,
          params.sortOrder,
          SORTABLE_FIELDS,
          'sortOrder',
        ),
      }),
      prisma.plan.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, params);
  }

  /** Active plans for the registration dropdown. Unpaginated by design. */
  async listActive(): Promise<Plan[]> {
    return prisma.plan.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { pricePaise: 'asc' }],
    });
  }

  async getById(id: string): Promise<Plan> {
    const plan = await prisma.plan.findFirst({
      where: { id, deletedAt: null },
    });
    if (!plan) throw new NotFoundError('Plan');
    return plan;
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    const parsed = input as Required<CreatePlanInput>;

    const existing = await prisma.plan.findFirst({
      where: {
        name: { equals: parsed.name, mode: 'insensitive' },
        deletedAt: null,
      },
    });

    if (existing) {
      throw new ConflictError(
        `A plan named "${parsed.name}" already exists`,
        'DUPLICATE_ENTRY',
      );
    }

    const plan = await prisma.plan.create({
      data: {
        name: parsed.name,
        description: parsed.description ?? null,
        type: parsed.type,
        durationDays: parsed.durationDays,
        pricePaise: parsed.pricePaise,
        joiningFeePaise: parsed.joiningFeePaise ?? 0,
        maxFreezeDays: parsed.maxFreezeDays ?? 0,
        features: parsed.features ?? [],
        isActive: parsed.isActive ?? true,
        sortOrder: parsed.sortOrder ?? 0,
      },
    });

    log.info({ planId: plan.id, name: plan.name }, 'Plan created');
    return plan;
  }

  /**
   * Update a plan.
   *
   * Price and duration changes affect only FUTURE purchases. Existing
   * memberships copied their price at purchase time, so a member who paid
   * ₹4,000 last month keeps that figure on their receipt when the plan rises
   * to ₹4,500 — which is both correct accounting and what they were promised.
   */
  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    await this.getById(id);

    if (input.name) {
      const clash = await prisma.plan.findFirst({
        where: {
          name: { equals: input.name, mode: 'insensitive' },
          deletedAt: null,
          NOT: { id },
        },
      });
      if (clash) {
        throw new ConflictError(
          `A plan named "${input.name}" already exists`,
          'DUPLICATE_ENTRY',
        );
      }
    }

    const plan = await prisma.plan.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.durationDays !== undefined
          ? { durationDays: input.durationDays }
          : {}),
        ...(input.pricePaise !== undefined
          ? { pricePaise: input.pricePaise }
          : {}),
        ...(input.joiningFeePaise !== undefined
          ? { joiningFeePaise: input.joiningFeePaise }
          : {}),
        ...(input.maxFreezeDays !== undefined
          ? { maxFreezeDays: input.maxFreezeDays }
          : {}),
        ...(input.features !== undefined ? { features: input.features } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    log.info({ planId: id }, 'Plan updated');
    return plan;
  }

  /**
   * Retire a plan.
   *
   * Soft delete only. A hard delete would orphan the memberships that
   * reference it and destroy the payment history attached to them. Members on
   * the plan keep it until their period ends; it simply stops being offered.
   */
  async retire(id: string): Promise<void> {
    await this.getById(id);

    const activeCount = await prisma.membership.count({
      where: { planId: id, status: { in: ['ACTIVE', 'FROZEN'] } },
    });

    await prisma.plan.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });

    log.info(
      { planId: id, activeMemberships: activeCount },
      'Plan retired; existing memberships unaffected',
    );
  }

  /** Member counts per plan — powers the dashboard's plan-distribution chart. */
  /**
   * Which plans the business is on.
   *
   * WITHOUT a range: the live mix — what the currently ACTIVE members hold.
   * That answers "what does the member base look like today?".
   *
   * WITH a range: what was SOLD in that window, by membership start date,
   * whatever its status is now. A membership sold in March and since
   * expired still counts as a March sale — filtering it out would make past
   * periods shrink every time you looked at them.
   */
  async getDistribution(
    range?: { from: Date; to: Date },
  ): Promise<Array<{ planId: string; planName: string; count: number }>> {
    const grouped = await prisma.membership.groupBy({
      by: ['planId'],
      where: range
        ? { startDate: { gte: range.from, lte: range.to } }
        : { status: 'ACTIVE' },
      _count: { _all: true },
    });

    if (grouped.length === 0) return [];

    const plans = await prisma.plan.findMany({
      where: { id: { in: grouped.map((g) => g.planId) } },
      select: { id: true, name: true },
    });

    const nameById = new Map(plans.map((p) => [p.id, p.name]));

    return grouped
      .map((g) => ({
        planId: g.planId,
        planName: nameById.get(g.planId) ?? 'Unknown',
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count);
  }
}

export const plansService = new PlansService();
