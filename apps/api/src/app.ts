import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Application } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env, isProduction } from './config/env.js';
import {
  errorHandler,
  notFoundHandler,
} from './middleware/error.middleware.js';
import { attendanceRoutes } from './modules/attendance/attendance.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { cronRoutes } from './modules/cron/cron.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { expensesRoutes } from './modules/expenses/expenses.routes.js';
import { invoicesRoutes } from './modules/invoices/invoices.routes.js';
import { leadsRoutes } from './modules/leads/leads.routes.js';
import { importRoutes } from './modules/import/import.routes.js';
import { membersRoutes } from './modules/members/members.routes.js';
import { messagesRoutes } from './modules/messages/messages.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';
import {
  membershipsRoutes,
  plansRoutes,
} from './modules/plans/plans.routes.js';
import { smsRoutes } from './modules/sms/sms.routes.js';

export function createApp(): Application {
  const app = express();

  // Behind a reverse proxy in production, req.ip must come from
  // X-Forwarded-For or rate limiting keys every request to the proxy's IP.
  if (isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      // Member photos are served from this origin and embedded in the SPA.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin: env.WEB_BASE_URL,
      // Required for the httpOnly refresh-token cookie.
      credentials: true,
      // Explicit allowlists rather than the library's default of reflecting
      // whatever the preflight asks for. The app only ever needs these;
      // anything else is refused rather than permitted by omission.
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );

  app.use(compression());

  // Photos arrive as base64 data URLs, which inflate by ~33%. The limit still
  // has to sit above MAX_UPLOAD_BYTES or valid captures get rejected.
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      // Health checks should never be throttled.
      skip: (req) => req.path === '/api/health',
      message: {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down.',
        },
      },
    }),
  );

  // Member photos and generated receipts.
  app.use(
    '/uploads',
    express.static(path.resolve(env.UPLOAD_DIR), {
      maxAge: isProduction ? '7d' : 0,
      index: false,
      dotfiles: 'deny',
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        service: 'azf-api',
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/attendance', attendanceRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/members', membersRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/import', importRoutes);
  app.use('/api/notifications', notificationsRoutes);
  // Scheduled work. Authenticated by CRON_SECRET, not a session — see the
  // note in cron.routes.ts.
  app.use('/api/cron', cronRoutes);
  app.use('/api/plans', plansRoutes);
  app.use('/api/memberships', membershipsRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/invoices', invoicesRoutes);
  app.use('/api/expenses', expensesRoutes);
  app.use('/api/leads', leadsRoutes);
  app.use('/api/sms', smsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
