import { Role } from '@azf/shared';
import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware.js';
import { asyncHandler } from '../../middleware/error.middleware.js';
import { generateReportPdf } from '../../services/pdf/report.service.js';
import { membershipsService } from '../plans/memberships.service.js';
import { plansService } from '../plans/plans.service.js';
import { paymentsService } from '../payments/payments.service.js';
import {
  analyticsService,
  parseDateParam,
  resolvePeriod,
  type PeriodKey,
} from './analytics.service.js';
import {
  dashboardService,
  type ChartRange,
} from './dashboard.service.js';

const VALID_PERIODS: PeriodKey[] = [
  'today',
  'week',
  'month',
  'quarter',
  'year',
  'all',
  'custom',
];

/**
 * Turn a period (plus optional custom dates) into an absolute chart window.
 *
 * 'all' returns undefined so the charts keep their default trailing window —
 * an all-time bucket range starting at the year 2000 would be thousands of
 * empty months.
 */
function resolveChartRange(
  period: PeriodKey,
  from: unknown,
  to: unknown,
): ChartRange | undefined {
  if (period === 'all') return undefined;

  if (period === 'custom') {
    const customFrom = parseDateParam(from);
    const customTo = parseDateParam(to);
    if (!customFrom || !customTo) return undefined;
    const range = resolvePeriod('custom', new Date(), {
      from: customFrom,
      to: customTo,
    });
    return widenForCharts({ from: range.from, to: range.to });
  }

  const range = resolvePeriod(period);
  return widenForCharts({ from: range.from, to: range.to });
}

/**
 * Give a very short window enough context to be worth drawing.
 *
 * "Today", and "this week" on a Monday, are one day — arithmetically right
 * and visually useless: a single bar shows no trend, no comparison, nothing
 * the chart exists for. Charts below a week are extended BACKWARDS to 14
 * days so the selected period sits at the right-hand edge with its recent
 * history behind it.
 *
 * Only the CHARTS widen. The KPI figures keep the exact window the owner
 * chose — "collected today" must mean today, or the number is a lie.
 */
function widenForCharts(range: ChartRange): ChartRange {
  const dayMs = 24 * 60 * 60 * 1000;
  const days =
    Math.round((range.to.getTime() - range.from.getTime()) / dayMs) + 1;

  if (days >= 7) return range;

  const from = new Date(range.to);
  from.setDate(from.getDate() - 13);
  from.setHours(0, 0, 0, 0);
  return { from, to: range.to };
}

const router = Router();

router.use(authenticate);

/**
 * One call returns everything the dashboard needs.
 *
 * Nine separate endpoints would mean nine round trips to Supabase before the
 * page finished painting. The queries run in parallel here, so the whole
 * payload costs roughly what the slowest one does.
 */
router.get(
  '/',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(async (req, res) => {
    // The charts are scoped ONLY when a period is asked for. Without it the
    // response keeps its trailing 12-month / 90-day shape, which is what the
    // dashboard's live feed wants and what every existing caller expects.
    const requested = String(req.query.period ?? '') as PeriodKey;
    const chartRange = VALID_PERIODS.includes(requested)
      ? resolveChartRange(requested, req.query.from, req.query.to)
      : undefined;

    const [
      overview,
      revenueTrend,
      memberGrowth,
      planDistribution,
      paymentModes,
      peakHours,
      recentCheckIns,
      expiring,
      defaulters,
    ] = await Promise.all([
      dashboardService.getOverview(),
      dashboardService.getRevenueTrend(12, chartRange),
      dashboardService.getMemberGrowth(12, chartRange),
      plansService.getDistribution(chartRange),
      dashboardService.getPaymentModeSplit(90, chartRange),
      dashboardService.getPeakHours(),
      dashboardService.getRecentCheckIns(),
      membershipsService.getExpiring(7),
      paymentsService.getDefaulters(5),
    ]);

    res.json({
      success: true,
      data: {
        overview,
        revenueTrend,
        memberGrowth,
        planDistribution: planDistribution.map((p) => ({
          name: p.planName,
          value: p.count,
        })),
        paymentModes,
        peakHours,
        recentCheckIns,
        expiring,
        defaulters,
      },
    });
  }),
);

/** Polled on its own by the live feed, which refreshes more often. */
router.get(
  '/check-ins',
  asyncHandler(async (_req, res) => {
    const checkIns = await dashboardService.getRecentCheckIns(15);
    res.json({ success: true, data: checkIns });
  }),
);

/**
 * Business report as a PDF.
 *
 * Generated on demand from live figures rather than stored: a report is read
 * once and must always reflect the current state, and regenerating costs less
 * than keeping stale copies on disk.
 */
router.get(
  '/report.pdf',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(async (req, res) => {
    const requested = String(req.query.period ?? 'year') as PeriodKey;
    let period = VALID_PERIODS.includes(requested) ? requested : 'year';

    // The PDF honours a custom range too, so a downloaded report matches the
    // figures the owner was looking at when they clicked. Without both ends
    // resolvePeriod would throw, so fall back to the year.
    const customFrom = parseDateParam(req.query.from);
    const customTo = parseDateParam(req.query.to);
    const customRange =
      period === 'custom' && customFrom && customTo
        ? { from: customFrom, to: customTo }
        : undefined;
    if (period === 'custom' && !customRange) period = 'year';

    // The PDF's charts follow the same period as its figures, so a printed
    // report is internally consistent rather than pairing a quarter's
    // numbers with a year's charts.
    const pdfChartRange = resolveChartRange(period, req.query.from, req.query.to);

    const [overview, revenueTrend, memberGrowth, planDistribution, paymentModes, defaulters, analytics] =
      await Promise.all([
        dashboardService.getOverview(),
        dashboardService.getRevenueTrend(12, pdfChartRange),
        dashboardService.getMemberGrowth(12, pdfChartRange),
        plansService.getDistribution(pdfChartRange),
        dashboardService.getPaymentModeSplit(90, pdfChartRange),
        paymentsService.getDefaulters(12),
        analyticsService.getPeriodAnalytics(period, customRange),
      ]);

    const { buffer, filename } = await generateReportPdf(
      {
        overview,
        revenueTrend,
        memberGrowth,
        planDistribution: planDistribution.map((plan) => ({
          name: plan.planName,
          value: plan.count,
        })),
        paymentModes,
        defaulters: defaulters.map((member) => ({
          memberId: member.memberId,
          fullName: member.fullName,
          phone: member.phone,
          balanceDuePaise: member.balanceDuePaise,
        })),
      },
      analytics.period.label,
    );

    res.setHeader('Content-Type', 'application/pdf');
    // `inline` opens in the browser viewer — an owner usually wants to look
    // before deciding whether to print or send it.
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.byteLength);
    res.send(buffer);
  }),
);

/**
 * Period analytics: today / week / month / quarter / year / all.
 *
 * Each response carries the equivalent preceding period, so the UI can show
 * a comparison without a second request.
 */
router.get(
  '/analytics',
  requireRole(Role.OWNER, Role.MANAGER),
  asyncHandler(async (req, res) => {
    const requested = String(req.query.period ?? 'month') as PeriodKey;
    const period = VALID_PERIODS.includes(requested) ? requested : 'month';

    // A custom period needs both ends. Missing or malformed dates fall back
    // to the month rather than throwing — a bad bookmark should show the
    // dashboard, not an error page.
    if (period === 'custom') {
      const from = parseDateParam(req.query.from);
      const to = parseDateParam(req.query.to);

      if (from && to) {
        const data = await analyticsService.getPeriodAnalytics('custom', {
          from,
          to,
        });
        res.json({ success: true, data });
        return;
      }

      const data = await analyticsService.getPeriodAnalytics('month');
      res.json({ success: true, data });
      return;
    }

    const data = await analyticsService.getPeriodAnalytics(period);
    res.json({ success: true, data });
  }),
);

/**
 * Today's collections.
 *
 * Available to receptionists too — it is the figure they reconcile the cash
 * drawer against at closing time.
 */
router.get(
  '/today',
  asyncHandler(async (_req, res) => {
    const data = await analyticsService.getTodayCollection();
    res.json({ success: true, data });
  }),
);

export { router as dashboardRoutes };
