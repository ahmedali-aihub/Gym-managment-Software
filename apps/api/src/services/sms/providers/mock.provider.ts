import { randomUUID } from 'node:crypto';
import { SmsStatus, countSmsSegments, type SmsSendResult } from '@azf/shared';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  SmsDeliveryStatus,
  SmsProviderAdapter,
  SmsSendParams,
} from './provider.interface.js';

const log = moduleLogger('sms:mock');

/**
 * Mock SMS provider for local development and tests.
 *
 * It sends nothing to real phones. What it does do is behave like a real
 * provider: variable latency, and a configurable failure rate so the retry
 * path and the failed-SMS queue are exercised during normal development
 * rather than discovered in production.
 *
 * Messages are kept in memory and exposed via getOutbox() so tests can assert
 * on what was sent, and the dev UI can show a phone-like preview.
 */

export interface MockSmsMessage {
  id: string;
  to: string;
  body: string;
  templateKey: string;
  sentAt: Date;
  segments: number;
  /** Simulated terminal state. */
  delivered: boolean;
}

/** Tuning knobs, overridable in tests. */
export interface MockProviderOptions {
  /** 0–1. Fraction of sends that fail. Default 0 outside tests. */
  failureRate?: number;
  /** Simulated network latency range, ms. */
  minLatencyMs?: number;
  maxLatencyMs?: number;
  /** Cap on retained outbox messages, to bound memory in long dev sessions. */
  maxOutboxSize?: number;
}

/** Failures a real gateway actually returns, for realistic error handling. */
const SIMULATED_FAILURES = [
  { code: 'INVALID_NUMBER', message: 'The destination number is not valid' },
  { code: 'DND_BLOCKED', message: 'Number is on the DND registry' },
  { code: 'INSUFFICIENT_BALANCE', message: 'Account balance is too low' },
  { code: 'GATEWAY_TIMEOUT', message: 'Upstream gateway did not respond' },
] as const;

export class MockSmsProvider implements SmsProviderAdapter {
  readonly name = 'MOCK';

  private readonly outbox: MockSmsMessage[] = [];
  private readonly failureRate: number;
  private readonly minLatencyMs: number;
  private readonly maxLatencyMs: number;
  private readonly maxOutboxSize: number;

  constructor(options: MockProviderOptions = {}) {
    this.failureRate = options.failureRate ?? 0;
    this.minLatencyMs = options.minLatencyMs ?? 40;
    this.maxLatencyMs = options.maxLatencyMs ?? 180;
    this.maxOutboxSize = options.maxOutboxSize ?? 500;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const { segments } = countSmsSegments(params.body);

    await this.simulateLatency();

    // A number that is not E.164 would be rejected by any real gateway.
    if (!/^\+91[6-9]\d{9}$/.test(params.to)) {
      return this.failure(
        'INVALID_NUMBER',
        `Not a valid Indian mobile number: ${params.to}`,
        segments,
      );
    }

    if (Math.random() < this.failureRate) {
      const failure =
        SIMULATED_FAILURES[
          Math.floor(Math.random() * SIMULATED_FAILURES.length)
        ]!;
      log.warn(
        { to: params.to, code: failure.code },
        'Mock SMS failed (simulated)',
      );
      return this.failure(failure.code, failure.message, segments);
    }

    const messageId = `mock_${randomUUID()}`;

    this.record({
      id: messageId,
      to: params.to,
      body: params.body,
      templateKey: params.templateKey,
      sentAt: new Date(),
      segments,
      delivered: true,
    });

    // Printed as a box so a developer can read the real text at a glance.
    log.info(
      `\n┌─ MOCK SMS ──────────────────────────────────────────\n` +
        `│ To:       ${params.to}\n` +
        `│ Template: ${params.templateKey}` +
        (params.dltTemplateId ? ` (DLT ${params.dltTemplateId})` : '') +
        `\n` +
        `│ Segments: ${segments}\n` +
        `├─────────────────────────────────────────────────────\n` +
        params.body
          .split('\n')
          .map((line) => `│ ${line}`)
          .join('\n') +
        `\n└─────────────────────────────────────────────────────`,
    );

    return {
      success: true,
      providerMessageId: messageId,
      // Mock treats sent as immediately delivered; the status poller will
      // confirm via getStatus() exactly as it would against a real provider.
      status: SmsStatus.SENT,
      errorCode: null,
      errorMessage: null,
      rawResponse: { provider: 'mock', messageId, segments },
      segments,
    };
  }

  async getStatus(providerMessageId: string): Promise<SmsDeliveryStatus> {
    const message = this.outbox.find((m) => m.id === providerMessageId);

    if (!message) {
      return {
        delivered: false,
        status: 'UNKNOWN',
        errorCode: 'NOT_FOUND',
        errorMessage: 'No such message in the mock outbox',
      };
    }

    return {
      delivered: message.delivered,
      status: message.delivered ? 'DELIVERED' : 'FAILED',
      deliveredAt: message.sentAt,
    };
  }

  async verifyConfiguration(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: true,
      message:
        'Mock SMS provider active — messages are logged, not delivered to real phones.',
    };
  }

  /** Everything "sent" this process, newest first. Used by tests and dev UI. */
  getOutbox(): readonly MockSmsMessage[] {
    return [...this.outbox].reverse();
  }

  clearOutbox(): void {
    this.outbox.length = 0;
  }

  private record(message: MockSmsMessage): void {
    this.outbox.push(message);
    if (this.outbox.length > this.maxOutboxSize) this.outbox.shift();
  }

  private failure(
    code: string,
    message: string,
    segments: number,
  ): SmsSendResult {
    return {
      success: false,
      providerMessageId: null,
      status: SmsStatus.FAILED,
      errorCode: code,
      errorMessage: message,
      rawResponse: { provider: 'mock', error: code },
      segments,
    };
  }

  private async simulateLatency(): Promise<void> {
    const ms =
      this.minLatencyMs +
      Math.random() * (this.maxLatencyMs - this.minLatencyMs);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
