/**
 * Typed application errors.
 *
 * Every error thrown deliberately by a service is an AppError with a stable
 * `code` the frontend can branch on. Anything else reaching the error handler
 * is treated as an unexpected fault: logged with its stack, reported to the
 * client as a generic 500 with no internals leaked.
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_ENTRY'
  | 'RATE_LIMITED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EXCEEDS_DUE'
  | 'SMS_FAILED'
  | 'INVALID_STATE'
  | 'EXTERNAL_SERVICE_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  /** Field-level messages, keyed by form field name. */
  readonly details?: Record<string, string[]>;
  /** True for errors safe to show the user verbatim. */
  readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: ErrorCode,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details) this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: Record<string, string[]>) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code: ErrorCode = 'CONFLICT') {
    super(message, 409, code);
  }
}

/**
 * The operation is valid in general but not in the record's current state —
 * e.g. freezing an already-frozen membership, or refunding a failed payment.
 */
export class InvalidStateError extends AppError {
  constructor(message: string) {
    super(message, 409, 'INVALID_STATE');
  }
}

export class PaymentError extends AppError {
  constructor(message: string, code: ErrorCode = 'PAYMENT_FAILED') {
    super(message, 400, code);
  }
}

export class ExternalServiceError extends AppError {
  readonly service: string;

  constructor(service: string, message: string) {
    super(
      `${service} is unavailable: ${message}`,
      502,
      'EXTERNAL_SERVICE_ERROR',
    );
    this.service = service;
  }
}

/** The JSON body every failed request returns. */
export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, string[]>;
  };
  requestId?: string;
}
