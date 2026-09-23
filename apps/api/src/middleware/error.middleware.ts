import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { AppError, type ErrorResponse } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { PrismaErrorCode, isPrismaError } from '../lib/prisma.js';
import { formatZodError } from './validate.middleware.js';

/**
 * Terminal error handler.
 *
 * Two rules govern what reaches the client:
 *  1. Deliberate AppErrors carry a stable code and a message written for the
 *     person at the front desk.
 *  2. Anything else is a bug. It is logged in full with a request ID, and the
 *     client gets a generic 500 — no stack traces, no SQL, no internals.
 */
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = randomUUID();

  // ── Deliberate application errors ──────────────────────────────────────
  if (error instanceof AppError) {
    // 5xx AppErrors still indicate something is wrong upstream.
    const level = error.statusCode >= 500 ? 'error' : 'warn';
    logger[level](
      {
        requestId,
        code: error.code,
        statusCode: error.statusCode,
        path: req.originalUrl,
        method: req.method,
        userId: req.user?.sub,
      },
      error.message,
    );

    const body: ErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      requestId,
    };

    res.status(error.statusCode).json(body);
    return;
  }

  // ── Zod errors that escaped the validation middleware ──────────────────
  if (error instanceof ZodError) {
    res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: formatZodError(error),
      },
      requestId,
    } satisfies ErrorResponse);
    return;
  }

  // ── Prisma errors, translated to something a human can act on ──────────
  if (isPrismaError(error, PrismaErrorCode.UNIQUE_CONSTRAINT)) {
    const target = error.meta?.target?.join(', ') ?? 'field';
    logger.warn({ requestId, target }, 'Unique constraint violation');

    res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: `A record with this ${humanizeField(target)} already exists`,
      },
      requestId,
    } satisfies ErrorResponse);
    return;
  }

  if (isPrismaError(error, PrismaErrorCode.RECORD_NOT_FOUND)) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Record not found' },
      requestId,
    } satisfies ErrorResponse);
    return;
  }

  if (isPrismaError(error, PrismaErrorCode.FOREIGN_KEY_CONSTRAINT)) {
    res.status(409).json({
      success: false,
      error: {
        code: 'CONFLICT',
        message:
          'This record is referenced elsewhere and cannot be changed or removed',
      },
      requestId,
    } satisfies ErrorResponse);
    return;
  }

  // ── Unexpected: a bug ──────────────────────────────────────────────────
  logger.error(
    {
      requestId,
      err: error,
      path: req.originalUrl,
      method: req.method,
      userId: req.user?.sub,
    },
    'Unhandled error',
  );

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction
        ? 'Something went wrong on our end. Please try again.'
        : error instanceof Error
          ? error.message
          : String(error),
    },
    requestId,
  } satisfies ErrorResponse);
};

/** 404 for unmatched routes, so the client always gets structured JSON. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} does not exist`,
    },
  } satisfies ErrorResponse);
}

/**
 * Wrap an async handler so a rejected promise reaches the error handler.
 * Express 4 does not do this automatically.
 */
export function asyncHandler<
  T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
>(handler: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

/** "memberId" → "member ID"; "phone" → "phone". */
function humanizeField(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/\bId\b/gi, 'ID')
    .trim()
    .toLowerCase();
}
