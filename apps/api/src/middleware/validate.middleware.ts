import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { ValidationError } from '../lib/errors.js';

/**
 * Validate a request against a Zod schema and replace the raw input with the
 * parsed result.
 *
 * The replacement is the important part: handlers downstream receive coerced,
 * trimmed, defaulted values, and TypeScript can infer their types from the
 * schema. An unvalidated `req.body` never reaches a service.
 */

type RequestPart = 'body' | 'query' | 'params';

export function validate<T>(schema: ZodSchema<T>, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);

    if (!result.success) {
      next(new ValidationError('Validation failed', formatZodError(result.error)));
      return;
    }

    // Express 4 lets us overwrite these; Express 5 makes query read-only,
    // hence the defineProperty fallback.
    if (part === 'query') {
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
      });
    } else {
      req[part] = result.data as never;
    }

    next();
  };
}

export const validateBody = <T>(schema: ZodSchema<T>) => validate(schema, 'body');
export const validateQuery = <T>(schema: ZodSchema<T>) => validate(schema, 'query');
export const validateParams = <T>(schema: ZodSchema<T>) =>
  validate(schema, 'params');

/**
 * Turn Zod issues into a field-keyed map the frontend can drop straight into
 * React Hook Form's error state.
 *
 * @example { "payment.amountPaid": ["Amount must be greater than zero"] }
 */
export function formatZodError(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    // Root-level refinements have an empty path.
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (details[key] ??= []).push(issue.message);
  }

  return details;
}
