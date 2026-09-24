import type {
  AxiosAdapter,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import {
  DEMO_MEMBERS,
  DEMO_USER,
  buildDashboard,
  buildMemberStats,
  type DemoMember,
} from './demo-data';
import {
  DEMO_PAYMENTS,
  DEMO_SMS_FAILED,
  DEMO_SMS_LOGS,
  buildMemberHistory,
  buildMemberProfile,
  buildPaymentStats,
  buildPeriodAnalytics,
  buildScopedCharts,
  buildSmsStats,
  buildTodayCollection,
} from './demo-extra';
import {
  DEMO_EXPENSES,
  buildProfitAndLoss,
} from './demo-business';

/**
 * Demo mode — lets the UI be reviewed before the database exists.
 *
 * Installed as an axios ADAPTER rather than an interceptor, so requests are
 * answered locally and never reach the network. Nothing in the feature code
 * knows this exists: components call the same endpoints they will call in
 * production, so what you click through is the real interface, not a mock-up
 * that has to be rewritten later.
 *
 * Enabled by VITE_DEMO_MODE=true, and automatically forced OFF in a
 * production build — shipping a build that silently serves fake member data
 * would be far worse than shipping one that errors honestly.
 */

export const isDemoMode =
  import.meta.env.VITE_DEMO_MODE === 'true' && import.meta.env.DEV;

/** Network latency simulation, so loading states are actually visible. */
const MIN_LATENCY_MS = 180;
const MAX_LATENCY_MS = 420;

function delay(): Promise<void> {
  const ms = MIN_LATENCY_MS + Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ok<T>(data: T, config: AxiosRequestConfig): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as never,
  };
}

function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;

  return {
    data: items.slice(start, start + limit),
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
 * Resolve a demo period into an absolute window.
 *
 * Mirrors resolvePeriod on the API — including the Indian financial year and
 * financial quarters — so demo mode does not quietly disagree with the real
 * thing about what "this quarter" means.
 */
/** See widenForCharts in dashboard.routes.ts — kept in step with it. */
function widenDemoChartWindow(range: { from: Date; to: Date }) {
  const dayMs = 86_400_000;
  const days = Math.round((range.to.getTime() - range.from.getTime()) / dayMs) + 1;
  if (days >= 7) return range;

  const from = new Date(range.to);
  from.setDate(from.getDate() - 13);
  from.setHours(0, 0, 0, 0);
  return { from, to: range.to };
}

function resolveDemoWindow(
  period: string,
  from: unknown,
  to: unknown,
): { from: Date; to: Date } | null {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const startOf = (date: Date) => {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };

  switch (period) {
    case 'today':
      return { from: startOf(now), to: endOfToday };

    case 'week': {
      const start = startOf(now);
      // Weeks start Monday, as they do on the API.
      start.setDate(start.getDate() - ((now.getDay() + 6) % 7));
      return { from: start, to: endOfToday };
    }

    case 'month':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: endOfToday,
      };

    case 'quarter': {
      const month = now.getMonth();
      const fyQuarter = Math.floor(((month + 9) % 12) / 3);
      const startMonth = (fyQuarter * 3 + 3) % 12;
      const startYear =
        startMonth > month ? now.getFullYear() - 1 : now.getFullYear();
      return { from: new Date(startYear, startMonth, 1), to: endOfToday };
    }

    case 'year': {
      const startYear =
        now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      return { from: new Date(startYear, 3, 1), to: endOfToday };
    }

    case 'custom': {
      const parse = (value: unknown): Date | null => {
        if (typeof value !== 'string') return null;
        const [y, m, d] = value.split('-').map(Number);
        if (!y || !m || !d) return null;
        return new Date(y, m - 1, d);
      };

      const start = parse(from);
      const end = parse(to);
      if (!start || !end) return null;

      const [earlier, later] = start <= end ? [start, end] : [end, start];
      const finish = new Date(later);
      finish.setHours(23, 59, 59, 999);
      return { from: startOf(earlier), to: finish };
    }

    default:
      return null;
  }
}

function filterMembers(params: Record<string, unknown>): DemoMember[] {
  let results = [...DEMO_MEMBERS];

  const search = String(params.search ?? '').trim().toLowerCase();
  if (search) {
    const digits = search.replace(/\D/g, '');
    results = results.filter(
      (m) =>
        m.fullName.toLowerCase().includes(search) ||
        m.memberId.toLowerCase().includes(search) ||
        (digits && m.phone.includes(digits)) ||
        (m.email?.toLowerCase().includes(search) ?? false),
    );
  }

  if (params.status) {
    results = results.filter((m) => m.status === params.status);
  }

  if (params.hasDues === 'true' || params.hasDues === true) {
    results = results.filter((m) => m.balanceDuePaise > 0);
  }

  if (params.goals) {
    const wanted = String(params.goals).split(',').filter(Boolean);
    if (wanted.length > 0) {
      results = results.filter((m) =>
        m.goals.some((goal) => wanted.includes(goal)),
      );
    }
  }

  if (params.expiringInDays) {
    const days = Number(params.expiringInDays);
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + days);

    results = results.filter((m) => {
      if (m.status !== 'ACTIVE') return false;
      const end = new Date(m.memberships[0]!.endDate);
      return end >= now && end <= cutoff;
    });
  }

  // Date ranges. Mirrors the API: yyyy-MM-dd parsed as LOCAL dates covering
  // whole days, so a range never drops the first or last day's members.
  const rangeStart = (iso: unknown): Date | null => {
    if (typeof iso !== 'string') return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };
  const rangeEnd = (iso: unknown): Date | null => {
    const date = rangeStart(iso);
    if (date) date.setHours(23, 59, 59, 999);
    return date;
  };

  const joinedFrom = rangeStart(params.joinedFrom);
  const joinedTo = rangeEnd(params.joinedTo);
  if (joinedFrom && joinedTo) {
    results = results.filter((m) => {
      const joined = new Date(m.joinedAt);
      return joined >= joinedFrom && joined <= joinedTo;
    });
  }

  const expiringFrom = rangeStart(params.expiringFrom);
  const expiringTo = rangeEnd(params.expiringTo);
  if (expiringFrom && expiringTo) {
    results = results.filter((m) => {
      const membership = m.memberships[0];
      if (!membership) return false;
      const end = new Date(membership.endDate);
      return end >= expiringFrom && end <= expiringTo;
    });
  }

  return results;
}

/**
 * Route a request to demo data.
 * Returns null when the path is unrecognised, so the caller can 404 it
 * rather than silently returning an empty success.
 */
function route(
  method: string,
  url: string,
  config: AxiosRequestConfig,
): AxiosResponse | null {
  const params = (config.params ?? {}) as Record<string, unknown>;
  const path = url.replace(/^\/api/, '').split('?')[0] ?? '';

  // ── Auth ───────────────────────────────────────────────────────────
  if (path === '/auth/login' && method === 'post') {
    return ok(
      {
        success: true,
        data: {
          user: DEMO_USER,
          accessToken: 'demo-access-token',
          expiresIn: 900,
        },
      },
      config,
    );
  }

  if (path === '/auth/refresh' && method === 'post') {
    return ok(
      {
        success: true,
        data: { accessToken: 'demo-access-token', expiresIn: 900 },
      },
      config,
    );
  }

  if (path === '/auth/me') {
    return ok({ success: true, data: DEMO_USER }, config);
  }

  if (path === '/auth/logout' && method === 'post') {
    return ok({ success: true, data: { message: 'Signed out' } }, config);
  }

  // ── Dashboard ──────────────────────────────────────────────────────
  if (path === '/dashboard/report.pdf') {
    // Generated by the API from live figures; there is no server here.
    return null;
  }

  if (path === '/dashboard/analytics') {
    const period = String(params.period ?? 'month');
    const custom =
      period === 'custom' && params.from && params.to
        ? { from: String(params.from), to: String(params.to) }
        : undefined;
    return ok(
      { success: true, data: buildPeriodAnalytics(period, custom) },
      config,
    );
  }

  if (path === '/dashboard/today') {
    return ok({ success: true, data: buildTodayCollection() }, config);
  }

  if (path === '/dashboard') {
    const base = buildDashboard();
    // A period scopes the charts, exactly as it does on the API. Without one
    // the response keeps its trailing-window shape.
    const period = String(params.period ?? '');
    const chosen =
      period && period !== 'all'
        ? resolveDemoWindow(period, params.from, params.to)
        : null;
    // Mirrors widenForCharts on the API: a one-day window drawn as a single
    // bar shows no trend at all, so charts below a week get 14 days of
    // context. The KPI figures keep the exact window regardless.
    const window = chosen ? widenDemoChartWindow(chosen) : null;

    return ok(
      {
        success: true,
        data: window ? { ...base, ...buildScopedCharts(window.from, window.to) } : base,
      },
      config,
    );
  }

  // ── Members ────────────────────────────────────────────────────────
  if (path === '/members/stats') {
    return ok({ success: true, data: buildMemberStats() }, config);
  }

  if (path === '/members' && method === 'get') {
    const filtered = filterMembers(params);
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;

    return ok({ success: true, ...paginate(filtered, page, limit) }, config);
  }

  const historyMatch = /^\/members\/([^/]+)\/history$/.exec(path);
  if (historyMatch && method === 'get') {
    const member = DEMO_MEMBERS.find((m) => m.id === historyMatch[1]);
    if (!member) return null;
    return ok({ success: true, data: buildMemberHistory(member) }, config);
  }

  const memberMatch = /^\/members\/([^/]+)$/.exec(path);
  if (memberMatch && method === 'get') {
    const member = DEMO_MEMBERS.find((m) => m.id === memberMatch[1]);
    if (!member) return null;
    return ok({ success: true, data: buildMemberProfile(member) }, config);
  }

  // Registration: acknowledge without persisting. The banner already tells
  // the user nothing is saved, and returning a plausible response lets the
  // whole flow — including the success redirect — be exercised.
  if (path === '/members' && method === 'post') {
    const first = DEMO_MEMBERS[0]!;
    return ok(
      {
        success: true,
        data: {
          member: { id: first.id, memberId: 'AZF-2026-0201' },
          qrDataUrl: buildMemberProfile(first).qrDataUrl,
        },
      },
      config,
    );
  }

  // ── Payments ───────────────────────────────────────────────────────
  if (path === '/payments/stats') {
    return ok({ success: true, data: buildPaymentStats() }, config);
  }

  if (path === '/payments/defaulters') {
    return ok({ success: true, data: buildDashboard().defaulters }, config);
  }

  if (path === '/payments' && method === 'get') {
    let results = [...DEMO_PAYMENTS];

    const search = String(params.search ?? '').trim().toLowerCase();
    if (search) {
      results = results.filter(
        (p) =>
          p.member.fullName.toLowerCase().includes(search) ||
          p.member.memberId.toLowerCase().includes(search) ||
          (p.reference?.toLowerCase().includes(search) ?? false),
      );
    }

    if (params.mode) {
      results = results.filter((p) => p.mode === params.mode);
    }

    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;

    return ok({ success: true, ...paginate(results, page, limit) }, config);
  }

  if (path === '/payments' && method === 'post') {
    const body = (config.data ? JSON.parse(String(config.data)) : {}) as {
      amountPaise?: number;
      memberId?: string;
    };

    const member = DEMO_MEMBERS.find((m) => m.id === body.memberId);
    const remaining = Math.max(
      0,
      (member?.balanceDuePaise ?? 0) - (body.amountPaise ?? 0),
    );

    return ok(
      {
        success: true,
        data: {
          payment: { id: 'demo-payment-new' },
          balance: { balanceDuePaise: remaining },
        },
      },
      config,
    );
  }

  // ── Expenses ───────────────────────────────────────────────────────
  if (path === '/expenses/profit-loss') {
    return ok({ success: true, data: buildProfitAndLoss() }, config);
  }

  if (path === '/expenses' && method === 'get') {
    let results = [...DEMO_EXPENSES];

    if (params.category) {
      results = results.filter((e) => e.category === params.category);
    }

    const limit = Number(params.limit) || 20;
    return ok({ success: true, ...paginate(results, 1, limit) }, config);
  }

  if (path === '/expenses' && method === 'post') {
    return ok({ success: true, data: { id: 'demo-expense-new' } }, config);
  }

  if (path === '/expenses/roll-forward' && method === 'post') {
    return ok({ success: true, data: { created: 0, skipped: 5 } }, config);
  }

  if (/^\/expenses\/[^/]+$/.test(path) && (method === 'patch' || method === 'delete')) {
    return ok({ success: true, data: { id: path.split('/')[2] } }, config);
  }

  // ── Attendance ─────────────────────────────────────────────────────
  if (path === '/attendance/today') {
    return ok(
      { success: true, data: { total: 24, currentlyIn: 7 } },
      config,
    );
  }

  if (path === '/attendance/current') {
    const inGym = DEMO_MEMBERS.filter((m) => m.status === 'ACTIVE')
      .slice(0, 7)
      .map((member, index) => ({
        id: `demo-visit-${index}`,
        checkInAt: new Date(
          Date.now() - (index * 18 + 6) * 60_000,
        ).toISOString(),
        member: {
          id: member.id,
          memberId: member.memberId,
          fullName: member.fullName,
          photoUrl: null,
        },
      }));

    return ok({ success: true, data: inGym }, config);
  }

  if (path === '/attendance/check-in' && method === 'post') {
    const body = (config.data ? JSON.parse(String(config.data)) : {}) as {
      qrPayload?: string;
      memberId?: string;
    };

    // Resolve by printed ID; a QR payload embeds the same ID.
    const code = body.memberId ?? body.qrPayload?.split(':')[2] ?? '';
    const member =
      DEMO_MEMBERS.find(
        (m) => m.memberId.toUpperCase() === code.toUpperCase(),
      ) ?? null;

    if (!member) return null;

    const end = new Date(member.memberships[0]!.endDate);
    const daysRemaining = Math.ceil(
      (end.getTime() - Date.now()) / 86_400_000,
    );

    const warnings: Array<{ kind: string; message: string }> = [];
    if (member.status === 'EXPIRED') {
      warnings.push({
        kind: 'EXPIRED',
        message: `Membership expired ${Math.abs(daysRemaining)} days ago`,
      });
    } else if (daysRemaining <= 7) {
      warnings.push({
        kind: 'EXPIRING',
        message:
          daysRemaining === 0
            ? 'Membership expires today'
            : `Membership expires in ${daysRemaining} days`,
      });
    }
    if (member.balanceDuePaise > 0) {
      warnings.push({
        kind: 'DUES',
        message: `₹${Math.round(member.balanceDuePaise / 100).toLocaleString('en-IN')} outstanding`,
      });
    }

    return ok(
      {
        success: true,
        data: {
          attendance: {
            id: `demo-checkin-${Date.now()}`,
            checkInAt: new Date().toISOString(),
          },
          member: {
            id: member.id,
            memberId: member.memberId,
            fullName: member.fullName,
            photoUrl: null,
            status: member.status,
          },
          membership: {
            planName: member.memberships[0]!.plan.name,
            endDate: member.memberships[0]!.endDate,
            daysRemaining,
          },
          balanceDuePaise: member.balanceDuePaise,
          warnings,
        },
      },
      config,
    );
  }

  if (/^\/attendance\/[^/]+\/check-out$/.test(path) && method === 'post') {
    return ok({ success: true, data: { checkOutAt: new Date() } }, config);
  }

  // ── Memberships ────────────────────────────────────────────────────
  if (path === '/memberships/expiring') {
    const days = Number(params.days) || 7;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + days);

    const expiring = DEMO_MEMBERS.filter((member) => {
      if (member.status !== 'ACTIVE') return false;
      const end = new Date(member.memberships[0]!.endDate);
      return end >= now && end <= cutoff;
    })
      .sort(
        (a, b) =>
          new Date(a.memberships[0]!.endDate).getTime() -
          new Date(b.memberships[0]!.endDate).getTime(),
      )
      .map((member) => ({
        id: member.memberships[0]!.id,
        endDate: member.memberships[0]!.endDate,
        member: {
          id: member.id,
          memberId: member.memberId,
          fullName: member.fullName,
          phone: member.phone,
          photoUrl: null,
        },
        plan: { name: member.memberships[0]!.plan.name },
      }));

    return ok({ success: true, data: expiring }, config);
  }

  if (path === '/memberships/renew' && method === 'post') {
    return ok({ success: true, data: { status: 'ACTIVE' } }, config);
  }

  if (/^\/memberships\/[^/]+\/unfreeze$/.test(path) && method === 'post') {
    return ok({ success: true, data: { status: 'ACTIVE' } }, config);
  }

  if (path === '/memberships/freeze' && method === 'post') {
    return ok({ success: true, data: { status: 'FROZEN' } }, config);
  }

  // ── SMS ────────────────────────────────────────────────────────────
  if (path === '/sms/provider') {
    return ok(
      {
        success: true,
        data: {
          provider: 'MOCK',
          ok: true,
          message:
            'Mock SMS provider active — messages are logged, not delivered to real phones.',
        },
      },
      config,
    );
  }

  if (path === '/sms/send-bulk' && method === 'post') {
    const body = (config.data ? JSON.parse(String(config.data)) : {}) as {
      memberIds?: string[];
    };

    return ok(
      {
        success: true,
        data: { queued: body.memberIds?.length ?? 0, skipped: 0 },
      },
      config,
    );
  }

  if (path === '/sms/send' && method === 'post') {
    return ok(
      { success: true, data: { id: 'demo-sms-new', status: 'SENT' } },
      config,
    );
  }

  if (path === '/sms/stats') {
    return ok({ success: true, data: buildSmsStats() }, config);
  }

  if (path === '/sms/logs') {
    const limit = Number(params.limit) || 20;
    return ok(
      { success: true, ...paginate(DEMO_SMS_LOGS, 1, limit) },
      config,
    );
  }

  if (path === '/sms/failed') {
    const limit = Number(params.limit) || 20;
    return ok(
      { success: true, ...paginate(DEMO_SMS_FAILED, 1, limit) },
      config,
    );
  }

  // Retry: report the outcome a real gateway would give. A DND block or an
  // invalid number fails identically every time, so retrying those must not
  // pretend to succeed — otherwise the UI teaches the wrong lesson.
  const retryMatch = /^\/sms\/([^/]+)\/retry$/.exec(path);
  if (retryMatch && method === 'post') {
    const log = DEMO_SMS_LOGS.find((l) => l.id === retryMatch[1]);
    if (!log) return null;

    const permanent =
      log.errorCode === 'DND_BLOCKED' || log.errorCode === 'INVALID_NUMBER';

    return ok(
      {
        success: true,
        data: permanent
          ? log
          : { ...log, status: 'SENT', errorCode: null, errorMessage: null },
      },
      config,
    );
  }

  if (path === '/sms/retry-all' && method === 'post') {
    const permanent = DEMO_SMS_FAILED.filter(
      (l) => l.errorCode === 'DND_BLOCKED' || l.errorCode === 'INVALID_NUMBER',
    ).length;

    return ok(
      {
        success: true,
        data: {
          attempted: DEMO_SMS_FAILED.length,
          succeeded: DEMO_SMS_FAILED.length - permanent,
          failed: permanent,
        },
      },
      config,
    );
  }

  // ── Plans ──────────────────────────────────────────────────────────
  if (path === '/plans/distribution') {
    const counts = new Map<string, number>();
    for (const member of DEMO_MEMBERS) {
      if (member.status !== 'ACTIVE') continue;
      const name = member.memberships[0]!.plan.name;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    // Plan ids in the fixtures follow plan-1..plan-6 in the same order.
    const ids: Record<string, string> = {
      Monthly: 'plan-1',
      Quarterly: 'plan-2',
      'Half-Yearly': 'plan-3',
      Yearly: 'plan-4',
      'Student Monthly': 'plan-5',
      'Couple Quarterly': 'plan-6',
    };

    return ok(
      {
        success: true,
        data: [...counts.entries()]
          .map(([planName, count]) => ({
            planId: ids[planName] ?? planName,
            planName,
            count,
          }))
          .sort((a, b) => b.count - a.count),
      },
      config,
    );
  }

  if (path === '/plans' && method === 'post') {
    return ok({ success: true, data: { id: 'demo-plan-new' } }, config);
  }

  if (/^\/plans\/[^/]+$/.test(path) && method === 'patch') {
    return ok({ success: true, data: { id: path.split('/')[2] } }, config);
  }

  if (path === '/plans/active' || path === '/plans') {
    const plans = [
      {
        id: 'plan-1',
        name: 'Monthly',
        description: 'Full gym access, billed month to month.',
        type: 'MONTHLY',
        durationDays: 30,
        pricePaise: 150_000,
        joiningFeePaise: 50_000,
        maxFreezeDays: 0,
        features: ['Full gym access', 'Locker facility', 'Fitness assessment'],
        isActive: true,
      },
      {
        id: 'plan-2',
        name: 'Quarterly',
        description: 'Three months, at a better rate than monthly.',
        type: 'QUARTERLY',
        durationDays: 90,
        pricePaise: 400_000,
        joiningFeePaise: 50_000,
        maxFreezeDays: 7,
        features: [
          'Full gym access',
          'Locker facility',
          'Fitness assessment',
          'Diet consultation',
        ],
        isActive: true,
      },
      {
        id: 'plan-3',
        name: 'Half-Yearly',
        description: 'Six months, with a personal-training session included.',
        type: 'HALF_YEARLY',
        durationDays: 180,
        pricePaise: 700_000,
        joiningFeePaise: 0,
        maxFreezeDays: 15,
        features: [
          'Full gym access',
          'Locker facility',
          'Monthly assessment',
          'Diet plan',
          '1 PT session / month',
        ],
        isActive: true,
      },
      {
        id: 'plan-4',
        name: 'Yearly',
        description: 'Best value. Twelve months with full benefits.',
        type: 'YEARLY',
        durationDays: 365,
        pricePaise: 1_200_000,
        joiningFeePaise: 0,
        maxFreezeDays: 30,
        features: [
          'Full gym access',
          'Premium locker',
          'Monthly assessment',
          'Personalised diet plan',
          '2 PT sessions / month',
          'Guest passes',
        ],
        isActive: true,
      },
      {
        id: 'plan-5',
        name: 'Student Monthly',
        description: 'Discounted monthly rate. Valid student ID required.',
        type: 'MONTHLY',
        durationDays: 30,
        pricePaise: 100_000,
        joiningFeePaise: 30_000,
        maxFreezeDays: 0,
        features: ['Full gym access', 'Locker facility', 'Off-peak hours'],
        isActive: true,
      },
      {
        id: 'plan-6',
        name: 'Couple Quarterly',
        description: 'Three months for two members, sharing one plan.',
        type: 'QUARTERLY',
        durationDays: 90,
        pricePaise: 700_000,
        joiningFeePaise: 50_000,
        maxFreezeDays: 7,
        features: [
          'Full gym access for two',
          'Locker facility',
          'Joint fitness assessment',
        ],
        isActive: true,
      },
    ];

    return path === '/plans/active'
      ? ok({ success: true, data: plans }, config)
      : ok({ success: true, ...paginate(plans, 1, 20) }, config);
  }

  return null;
}

/** Install the demo adapter onto an axios instance. */
export function installDemoAdapter(instance: AxiosInstance): void {
  if (!isDemoMode) return;

  const adapter: AxiosAdapter = async (config) => {
    await delay();

    const method = (config.method ?? 'get').toLowerCase();
    const url = config.url ?? '';
    const response = route(method, url, config);

    if (response) return response;

    // Unhandled path: reject the way the real API would, so error states are
    // exercised rather than hidden.
    return Promise.reject(
      Object.assign(new Error('Not found in demo mode'), {
        isAxiosError: true,
        config,
        response: {
          status: 404,
          statusText: 'Not Found',
          headers: {},
          config,
          data: {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: `${url} is not available in demo mode. Connect a database to use this screen.`,
            },
          },
        },
      }),
    );
  };

  instance.defaults.adapter = adapter;

  console.info(
    '%c DEMO MODE %c Serving in-memory data — no database, nothing is saved.',
    'background:#9ade1f;color:#0f1419;font-weight:bold;padding:2px 6px;border-radius:3px',
    'color:#888',
  );
}
