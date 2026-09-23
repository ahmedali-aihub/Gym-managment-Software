import { SmsStatus, countSmsSegments, type SmsSendResult } from '@azf/shared';
import { env } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  SmsDeliveryStatus,
  SmsProviderAdapter,
  SmsSendParams,
} from './provider.interface.js';

const log = moduleLogger('sms:twilio');
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Twilio adapter.
 *
 * Called through the REST API directly rather than the SDK — one HTTP call,
 * no extra dependency, and the wire format is stable.
 *
 * Note on India: Twilio sends the full message body, so DLT compliance is the
 * sender's responsibility at the account level (template and header registered
 * with the operator). We still pass our rendered body, which must match the
 * approved template text exactly.
 */
export class TwilioProvider implements SmsProviderAdapter {
  readonly name = 'TWILIO';

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;

  constructor() {
    this.accountSid = env.TWILIO_ACCOUNT_SID ?? '';
    this.authToken = env.TWILIO_AUTH_TOKEN ?? '';
    this.fromNumber = env.TWILIO_FROM_NUMBER ?? '';
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const { segments } = countSmsSegments(params.body);

    const form = new URLSearchParams({
      To: params.to,
      From: this.fromNumber,
      Body: params.body,
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(
              `${this.accountSid}:${this.authToken}`,
            ).toString('base64')}`,
          },
          body: form.toString(),
          signal: controller.signal,
        },
      );

      clearTimeout(timeout);

      const raw = (await response.json().catch(() => null)) as {
        sid?: string;
        status?: string;
        message?: string;
        code?: number;
      } | null;

      if (!response.ok) {
        log.error({ status: response.status, raw }, 'Twilio rejected the send');
        return {
          success: false,
          providerMessageId: null,
          status: SmsStatus.FAILED,
          errorCode: raw?.code ? String(raw.code) : `HTTP_${response.status}`,
          errorMessage: raw?.message ?? `HTTP ${response.status}`,
          rawResponse: raw,
          segments,
        };
      }

      return {
        success: true,
        providerMessageId: raw?.sid ?? null,
        status: SmsStatus.SENT,
        errorCode: null,
        errorMessage: null,
        rawResponse: raw,
        segments,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: message }, 'Twilio request failed');

      return {
        success: false,
        providerMessageId: null,
        status: SmsStatus.FAILED,
        errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: message,
        rawResponse: null,
        segments,
      };
    }
  }

  async getStatus(providerMessageId: string): Promise<SmsDeliveryStatus> {
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages/${providerMessageId}.json`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${this.accountSid}:${this.authToken}`,
            ).toString('base64')}`,
          },
        },
      );

      const raw = (await response.json().catch(() => null)) as {
        status?: string;
        date_sent?: string;
        error_code?: number;
        error_message?: string;
      } | null;

      const status = raw?.status ?? 'unknown';
      const delivered = status === 'delivered';

      return {
        delivered,
        status,
        ...(delivered && raw?.date_sent
          ? { deliveredAt: new Date(raw.date_sent) }
          : {}),
        ...(raw?.error_code ? { errorCode: String(raw.error_code) } : {}),
        ...(raw?.error_message ? { errorMessage: raw.error_message } : {}),
      };
    } catch (error) {
      return {
        delivered: false,
        status: 'UNKNOWN',
        errorCode: 'STATUS_CHECK_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async verifyConfiguration(): Promise<{ ok: boolean; message: string }> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      return { ok: false, message: 'Twilio credentials are incomplete' };
    }
    return { ok: true, message: `Twilio configured, sending from ${this.fromNumber}.` };
  }
}
