import { waitUntil } from '@vercel/functions';
import { logger } from './logger.js';

/**
 * Run work after the response is sent, without the platform cutting it off.
 *
 * Welcome messages, receipt emails and SMS are deliberately not awaited: a
 * WhatsApp or mail-server outage must never fail a registration or payment
 * the member has already handed money over for. On a long-running server a
 * bare `void promise` is enough. On Vercel it is not — the function can be
 * frozen the moment the response goes out, which leaves the message row
 * QUEUED or SENDING for good, and the retry worker only picks up FAILED
 * rows, so nothing would ever send it.
 *
 * waitUntil() keeps the invocation alive until the promise settles. Outside
 * Vercel it does nothing and the promise simply runs, as before.
 *
 * Most tasks log their own failures with more context; this is the backstop
 * that keeps a rejection from going unhandled, which would crash the process.
 */
export function runInBackground(task: Promise<unknown>, label: string): void {
  waitUntil(
    task.catch((error: unknown) => {
      logger.error({ err: error, task: label }, 'Background task failed');
    }),
  );
}
