import pino from 'pino';
import { env, isDevelopment, isTest } from '../config/env.js';

/**
 * Structured logging.
 *
 * `redact` is not optional here: this system handles member phone numbers,
 * passwords and payment references. A stack trace that leaks a password into
 * a log aggregator is a breach, so the redaction list is maintained alongside
 * every field we add that could carry a secret or personal detail.
 */
export const logger = pino({
  level: isTest ? 'silent' : isDevelopment ? 'debug' : 'info',

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      'currentPassword',
      'newPassword',
      'confirmPassword',
      'accessToken',
      'refreshToken',
      'tokenHash',
      '*.accessToken',
      '*.refreshToken',
      'razorpaySignature',
      'MSG91_AUTH_KEY',
      'TWILIO_AUTH_TOKEN',
      'RAZORPAY_KEY_SECRET',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ],
    censor: '[REDACTED]',
  },

  base: { env: env.NODE_ENV },

  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:dd/mm/yyyy HH:MM:ss',
          ignore: 'pid,hostname,env',
          messageFormat: '{msg}',
        },
      }
    : undefined,
});

/** Child logger tagged with a module name, e.g. logger.child({ module }). */
export function moduleLogger(module: string) {
  return logger.child({ module });
}
