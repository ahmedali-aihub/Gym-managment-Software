import { Router } from 'express';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { moduleLogger } from '../../lib/logger.js';
import { emailService } from '../../services/email/email.service.js';
import { whatsappService } from '../../services/whatsapp/whatsapp.service.js';
import { membersService } from '../members/members.service.js';

const log = moduleLogger('cron');
const router = Router();

/**
 * Scheduled work, triggered by Vercel Cron.
 *
 * A serverless function only exists while it is handling a request, so the
 * `setInterval` timers in server.ts cannot run there. Vercel calls these
 * endpoints on a schedule instead (see vercel.json). Running the API as a
 * long-lived process still uses the timers; both paths call the same
 * service methods, so neither can drift from the other.
 *
 * AUTHENTICATED BY A SHARED SECRET, not a session. These are public URLs —
 * without the check, anyone could hammer the retry queue or force an expiry
 * sweep. Vercel sends CRON_SECRET as a bearer token on every scheduled call.
 */
function authorise(header: string | undefined): boolean {
  // No secret configured means cron is not in use; refuse rather than run
  // an open endpoint, because failing closed is the safe direction.
  if (!env.CRON_SECRET) return false;
  return header === `Bearer ${env.CRON_SECRET}`;
}

/**
 * Reconcile member status against membership expiry.
 *
 * Daily at 01:00. Without it, "active members" silently includes everyone
 * whose membership lapsed overnight, and every KPI built on that figure is
 * wrong until someone notices.
 */
router.get(
  '/sync-expiry',
  asyncHandler(async (req, res) => {
    if (!authorise(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const updated = await membersService.syncExpiredStatuses();
    log.info({ updated }, 'Expiry sync complete');

    res.json({ success: true, data: { updated } });
  }),
);

/**
 * Retry notifications that failed.
 *
 * Every 30 minutes. A Gmail hiccup or a rate limit would otherwise leave the
 * message FAILED for good, and the member simply never hears from the gym.
 */
router.get(
  '/retry-notifications',
  asyncHandler(async (req, res) => {
    if (!authorise(req.headers.authorization)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const [email, whatsapp] = await Promise.all([
      emailService.processRetryQueue(),
      whatsappService.processRetryQueue(),
    ]);

    log.info({ email, whatsapp }, 'Notification retry complete');
    res.json({ success: true, data: { email, whatsapp } });
  }),
);

export { router as cronRoutes };
