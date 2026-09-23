import type { PaginatedResponse } from '@azf/shared';

/**
 * Offset pagination helpers.
 *
 * Offset (rather than cursor) is the right call here: the UI offers jump-to-page
 * and sortable columns over a few thousand rows, where OFFSET stays cheap and
 * cursor pagination would forbid both.
 */

export interface PaginationParams {
  page: number;
  limit: number;
}

export function getSkipTake({ page, limit }: PaginationParams): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * limit, take: limit };
}

export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  { page, limit }: PaginationParams,
): PaginatedResponse<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

/**
 * Build a Prisma orderBy from a client-supplied sort field.
 *
 * The allowlist is the security boundary: without it, a caller could sort by
 * `passwordHash` and binary-search the column's contents one page at a time.
 */
export function buildOrderBy<T extends string>(
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc',
  allowedFields: readonly T[],
  defaultField: T,
): Record<string, 'asc' | 'desc'> {
  const field =
    sortBy && (allowedFields as readonly string[]).includes(sortBy)
      ? sortBy
      : defaultField;

  return { [field]: sortOrder };
}
