import {
  SMS_TEMPLATES,
  SmsStatus,
  SmsTemplateKey,
  countSmsSegments,
  renderSmsTemplate,
  toE164,
} from '@azf/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockSmsProvider } from '../../src/services/sms/providers/mock.provider.js';
import type {
  SmsProviderAdapter,
  SmsSendParams,
} from '../../src/services/sms/providers/provider.interface.js';

/**
 * SMS service tests.
 *
 * The service is tested against an in-memory Prisma fake rather than a live
 * database: the behaviour that matters here is the retry/backoff state machine
 * and the permanent-vs-transient error distinction, none of which needs
 * Postgres to verify.
 */

// ─── In-memory Prisma fake ───────────────────────────────────────────────────

interface FakeSmsLog {
  id: string;
  memberId: string | null;
  toPhone: string;
  templateKey: string;
  body: string;
  variables: unknown;
  provider: string;
  status: string;
  dltTemplateId: string | null;
  providerMessageId: string | null;
  rawResponse: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  segments: number;
  queuedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  sentById: string | null;
}

const store = new Map<string, FakeSmsLog>();
let idCounter = 0;

const prismaFake = {
  smsLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const id = `sms_${++idCounter}`;
      const row: FakeSmsLog = {
        id,
        memberId: (data.memberId as string | null) ?? null,
        toPhone: data.toPhone as string,
        templateKey: data.templateKey as string,
        body: data.body as string,
        variables: data.variables ?? null,
        provider: data.provider as string,
        status: (data.status as string) ?? SmsStatus.QUEUED,
        dltTemplateId: (data.dltTemplateId as string | null) ?? null,
        providerMessageId: null,
        rawResponse: null,
        errorCode: null,
        errorMessage: null,
        attempts: 0,
        maxAttempts: (data.maxAttempts as number) ?? 3,
        nextRetryAt: null,
        segments: (data.segments as number) ?? 1,
        queuedAt: new Date(),
        sentAt: null,
        deliveredAt: null,
        failedAt: null,
        sentById: (data.sentById as string | null) ?? null,
      };
      store.set(id, row);
      return { ...row };
    }),

    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const existing = store.get(where.id);
        if (!existing) throw new Error(`No SmsLog ${where.id}`);
        const updated = { ...existing, ...data } as FakeSmsLog;
        store.set(where.id, updated);
        return { ...updated };
      },
    ),

    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = store.get(where.id);
      if (!row) throw new Error(`No SmsLog ${where.id}`);
      return { ...row };
    }),

    findMany: vi.fn(
      async (args?: {
        where?: { status?: { in?: string[] } };
        take?: number;
      }) => {
        let rows = [...store.values()];
        const statuses = args?.where?.status?.in;
        if (statuses) rows = rows.filter((r) => statuses.includes(r.status));
        rows.sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime());
        return rows.slice(0, args?.take ?? rows.length).map((r) => ({ ...r }));
      },
    ),
  },
};

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: prismaFake,
  isPrismaError: () => false,
  PrismaErrorCode: {},
}));

// Imported after the mock is registered.
const { smsService } = await import('../../src/services/sms/sms.service.js');
const { setSmsProvider } = await import(
  '../../src/services/sms/providers/index.js'
);

/** Provider stub with scriptable outcomes. */
class ScriptedProvider implements SmsProviderAdapter {
  readonly name = 'MOCK';
  readonly calls: SmsSendParams[] = [];

  constructor(
    private readonly outcomes: Array<
      { ok: true } | { ok: false; code: string; message: string }
    >,
  ) {}

  async send(params: SmsSendParams) {
    this.calls.push(params);
    const { segments } = countSmsSegments(params.body);
    // Once the script runs out, keep repeating its final outcome.
    const outcome =
      this.outcomes[this.calls.length - 1] ??
      this.outcomes[this.outcomes.length - 1] ??
      ({ ok: true } as const);

    if (outcome.ok) {
      return {
        success: true as const,
        providerMessageId: `msg_${this.calls.length}`,
        status: SmsStatus.SENT,
        errorCode: null,
        errorMessage: null,
        rawResponse: { ok: true },
        segments,
      };
    }

    return {
      success: false as const,
      providerMessageId: null,
      status: SmsStatus.FAILED,
      errorCode: outcome.code,
      errorMessage: outcome.message,
      rawResponse: { ok: false },
      segments,
    };
  }

  async verifyConfiguration() {
    return { ok: true, message: 'scripted' };
  }
}

beforeEach(() => {
  store.clear();
  idCounter = 0;
  vi.clearAllMocks();
  setSmsProvider(null);
});

// ─── Template rendering ──────────────────────────────────────────────────────

describe('SMS templates', () => {
  it('renders the welcome message with every variable substituted', () => {
    const body = renderSmsTemplate(SMS_TEMPLATES.WELCOME.body, {
      name: 'Rahul Sharma',
      memberId: 'AZF-2026-0001',
      plan: 'Quarterly',
      startDate: '19/09/2026',
      expiryDate: '17/12/2026',
      amount: '4,000',
      gymPhone: '9000000000',
    });

    expect(body).toContain('Rahul Sharma');
    expect(body).toContain('AZF-2026-0001');
    expect(body).toContain('17/12/2026');
    // No placeholder may survive into a message sent to a member.
    expect(body).not.toMatch(/\{\{/);
  });

  it('leaves unknown placeholders intact rather than printing "undefined"', () => {
    const body = renderSmsTemplate('Hi {{name}}, ref {{missing}}', {
      name: 'Asha',
    });
    expect(body).toBe('Hi Asha, ref {{missing}}');
  });

  it('keeps the welcome message within a single billed segment', () => {
    // Longest realistic values: a long name and a long plan name.
    const body = renderSmsTemplate(SMS_TEMPLATES.WELCOME.body, {
      name: 'Venkata Subramanyam',
      memberId: 'AZF-2026-0247',
      plan: 'Half-Yearly',
      startDate: '19/09/2026',
      expiryDate: '17/03/2027',
      amount: '7,000',
      gymPhone: '+919000000000',
    });

    const { segments, encoding } = countSmsSegments(body);
    expect(encoding).toBe('GSM-7');
    expect(segments).toBe(1);
  });

  it('counts a rupee sign as UCS-2, which halves the segment size', () => {
    // A stray ₹ in a template would double the SMS bill — assert we detect it.
    const withSymbol = countSmsSegments('Amount ₹4000 received');
    expect(withSymbol.encoding).toBe('UCS-2');

    const withoutSymbol = countSmsSegments('Amount Rs.4000 received');
    expect(withoutSymbol.encoding).toBe('GSM-7');
  });

  it('every template declares the variables its body uses', () => {
    for (const template of Object.values(SMS_TEMPLATES)) {
      const used = [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map(
        (m) => m[1],
      );
      for (const variable of used) {
        expect(
          template.variables,
          `${template.key} uses {{${variable}}} but does not declare it`,
        ).toContain(variable);
      }
    }
  });
});

// ─── Sending ─────────────────────────────────────────────────────────────────

describe('smsService.send', () => {
  it('logs the message and marks it sent on success', async () => {
    setSmsProvider(new ScriptedProvider([{ ok: true }]));

    const result = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.WELCOME,
      variables: {
        name: 'Rahul',
        memberId: 'AZF-2026-0001',
        plan: 'Monthly',
        startDate: '19/09/2026',
        expiryDate: '18/10/2026',
        amount: '1,500',
        gymPhone: '9000000000',
      },
    });

    expect(result.status).toBe(SmsStatus.SENT);
    expect(result.providerMessageId).toBe('msg_1');
    expect(result.sentAt).not.toBeNull();
    expect(result.errorCode).toBeNull();
  });

  it('normalises the recipient to E.164 before sending', async () => {
    const provider = new ScriptedProvider([{ ok: true }]);
    setSmsProvider(provider);

    await smsService.send({
      to: '+91 98765 43210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
    });

    expect(provider.calls[0]?.to).toBe('+919876543210');
    expect(toE164('98765 43210')).toBe('+919876543210');
  });

  it('records the message but does not send when SMS is disabled', async () => {
    const provider = new ScriptedProvider([{ ok: true }]);
    setSmsProvider(provider);

    const { env } = await import('../../src/config/env.js');
    const original = env.SMS_ENABLED;
    (env as { SMS_ENABLED: boolean }).SMS_ENABLED = false;

    try {
      const result = await smsService.send({
        to: '9876543210',
        templateKey: SmsTemplateKey.BIRTHDAY,
        variables: { name: 'Asha' },
      });

      // Queued, not lost: re-enabling SMS and draining the queue delivers it.
      expect(result.status).toBe(SmsStatus.QUEUED);
      expect(provider.calls).toHaveLength(0);
    } finally {
      (env as { SMS_ENABLED: boolean }).SMS_ENABLED = original;
    }
  });

  it('queues without sending when immediate is false', async () => {
    const provider = new ScriptedProvider([{ ok: true }]);
    setSmsProvider(provider);

    const result = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.DUES_REMINDER,
      variables: { name: 'A', memberId: 'AZF-2026-0001', amount: '500', gymPhone: '9000000000' },
      immediate: false,
    });

    expect(result.status).toBe(SmsStatus.QUEUED);
    expect(provider.calls).toHaveLength(0);
  });
});

// ─── Retry behaviour ─────────────────────────────────────────────────────────

describe('retry and failure handling', () => {
  it('schedules a retry after a transient failure', async () => {
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'GATEWAY_TIMEOUT', message: 'timeout' },
      ]),
    );

    const result = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
    });

    expect(result.status).toBe(SmsStatus.FAILED);
    expect(result.attempts).toBe(1);
    expect(result.nextRetryAt).toBeInstanceOf(Date);
    expect(result.errorCode).toBe('GATEWAY_TIMEOUT');
  });

  it('does NOT retry a permanently rejected message', async () => {
    // An invalid number fails identically every time; retrying burns credits.
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'INVALID_NUMBER', message: 'bad number' },
      ]),
    );

    const result = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
    });

    expect(result.status).toBe(SmsStatus.DEAD);
    expect(result.nextRetryAt).toBeNull();
  });

  it('treats a DND block as permanent', async () => {
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'DND_BLOCKED', message: 'on DND registry' },
      ]),
    );

    const result = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.WINBACK,
      variables: { name: 'Asha', days: 30, gymPhone: '9000000000' },
    });

    expect(result.status).toBe(SmsStatus.DEAD);
  });

  it('moves to the dead queue once the retry budget is exhausted', async () => {
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'GATEWAY_TIMEOUT', message: 'timeout' },
      ]),
    );

    let row = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
    });
    expect(row.status).toBe(SmsStatus.FAILED);

    // maxAttempts is 3: two further attempts should exhaust it.
    row = await smsService.attemptDelivery(row);
    expect(row.attempts).toBe(2);
    expect(row.status).toBe(SmsStatus.FAILED);

    row = await smsService.attemptDelivery(row);
    expect(row.attempts).toBe(3);
    expect(row.status).toBe(SmsStatus.DEAD);
    expect(row.nextRetryAt).toBeNull();
  });

  it('succeeds on a retry after a transient failure', async () => {
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'GATEWAY_TIMEOUT', message: 'timeout' },
        { ok: true },
      ]),
    );

    const first = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
    });
    expect(first.status).toBe(SmsStatus.FAILED);

    const second = await smsService.attemptDelivery(first);
    expect(second.status).toBe(SmsStatus.SENT);
    // The error from the failed attempt must be cleared on success.
    expect(second.errorCode).toBeNull();
    expect(second.nextRetryAt).toBeNull();
  });

  it('backs off exponentially between attempts', async () => {
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'GATEWAY_TIMEOUT', message: 'timeout' },
      ]),
    );

    const first = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
    });
    const firstDelay = first.nextRetryAt!.getTime() - Date.now();

    const second = await smsService.attemptDelivery(first);
    const secondDelay = second.nextRetryAt!.getTime() - Date.now();

    // Second wait is roughly double the first, allowing for jitter.
    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it('gives a dead message a fresh budget on manual retry', async () => {
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'INVALID_NUMBER', message: 'bad number' },
      ]),
    );

    const dead = await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
    });
    expect(dead.status).toBe(SmsStatus.DEAD);

    // The operator fixed the number, so the next attempt should succeed.
    setSmsProvider(new ScriptedProvider([{ ok: true }]));
    const retried = await smsService.retryMessage(dead.id);

    expect(retried.status).toBe(SmsStatus.SENT);
    expect(retried.attempts).toBe(1);
  });
});

// ─── Retry queue ─────────────────────────────────────────────────────────────

describe('processRetryQueue', () => {
  it('drains queued and failed messages', async () => {
    setSmsProvider(new ScriptedProvider([{ ok: true }]));

    for (let i = 0; i < 3; i++) {
      await smsService.send({
        to: '9876543210',
        templateKey: SmsTemplateKey.BIRTHDAY,
        variables: { name: `Member ${i}` },
        immediate: false,
      });
    }

    const result = await smsService.processRetryQueue();

    expect(result.processed).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
  });

  it('reports failures separately from successes', async () => {
    setSmsProvider(
      new ScriptedProvider([
        { ok: false, code: 'GATEWAY_TIMEOUT', message: 'timeout' },
      ]),
    );

    await smsService.send({
      to: '9876543210',
      templateKey: SmsTemplateKey.BIRTHDAY,
      variables: { name: 'Asha' },
      immediate: false,
    });

    const result = await smsService.processRetryQueue();
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });
});

// ─── Mock provider ───────────────────────────────────────────────────────────

describe('MockSmsProvider', () => {
  it('rejects a number that is not valid Indian E.164', async () => {
    const provider = new MockSmsProvider({ minLatencyMs: 0, maxLatencyMs: 1 });

    const result = await provider.send({
      to: '+911234567890', // starts with 1 — not a valid mobile prefix
      body: 'Test',
      templateKey: SmsTemplateKey.CUSTOM,
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_NUMBER');
  });

  it('records sent messages in an inspectable outbox', async () => {
    const provider = new MockSmsProvider({ minLatencyMs: 0, maxLatencyMs: 1 });

    await provider.send({
      to: '+919876543210',
      body: 'Welcome to A to Z Fitness',
      templateKey: SmsTemplateKey.WELCOME,
    });

    const outbox = provider.getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe('+919876543210');
  });

  it('never rejects, even when the send fails', async () => {
    // The service relies on this: a provider that throws would roll back the
    // member registration that triggered the SMS.
    const provider = new MockSmsProvider({
      failureRate: 1,
      minLatencyMs: 0,
      maxLatencyMs: 1,
    });

    await expect(
      provider.send({
        to: '+919876543210',
        body: 'Test',
        templateKey: SmsTemplateKey.CUSTOM,
      }),
    ).resolves.toMatchObject({ success: false });
  });

  it('reports itself as correctly configured', async () => {
    const provider = new MockSmsProvider();
    const result = await provider.verifyConfiguration();
    expect(result.ok).toBe(true);
  });
});
