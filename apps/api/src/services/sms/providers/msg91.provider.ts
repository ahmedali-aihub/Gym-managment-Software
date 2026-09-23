import {
  SmsStatus,
  SmsTemplateKey,
  countSmsSegments,
  type SmsSendResult,
} from '@azf/shared';
import { env } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  SmsDeliveryStatus,
  SmsProviderAdapter,
  SmsSendParams,
} from './provider.interface.js';

const log = moduleLogger('sms:msg91');

const MSG91_BASE_URL = 'https://control.msg91.com/api';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * MSG91 adapter — the default provider for Indian transactional SMS.
 *
 * Uses the Flow API (v5), where the message body is defined by a DLT-approved
 * template registered with MSG91 and the caller supplies only the variables.
 * This is deliberate: sending free-form text that deviates from the registered
 * template gets the message silently dropped by the telecom operator, with no
 * error returned. The rendered body we hold locally is stored for the audit
 * log and for the UI preview, not sent as the message content.
 */
export class Msg91Provider implements SmsProviderAdapter {
  readonly name = 'MSG91';

  private readonly authKey: string;
  private readonly senderId: string;

  constructor() {
    // env validation already guarantees this is present for SMS_PROVIDER=msg91.
    this.authKey = env.MSG91_AUTH_KEY ?? '';
    this.senderId = env.SMS_SENDER_ID;
  }

  /** Map our template keys to the DLT template IDs configured in .env. */
  private resolveTemplateId(key: SmsTemplateKey): string | undefined {
    const map: Partial<Record<SmsTemplateKey, string | undefined>> = {
      [SmsTemplateKey.WELCOME]: env.MSG91_TEMPLATE_WELCOME,
      [SmsTemplateKey.EXPIRY_REMINDER]: env.MSG91_TEMPLATE_EXPIRY,
      [SmsTemplateKey.DUES_REMINDER]: env.MSG91_TEMPLATE_DUES,
      [SmsTemplateKey.BIRTHDAY]: env.MSG91_TEMPLATE_BIRTHDAY,
      [SmsTemplateKey.WINBACK]: env.MSG91_TEMPLATE_WINBACK,
    };
    return map[key];
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const { segments } = countSmsSegments(params.body);
    const templateId = params.dltTemplateId ?? this.resolveTemplateId(params.templateKey);

    if (!templateId) {
      // Fail fast and loudly: without a DLT template the operator will drop
      // the message, and we would otherwise record a false success.
      return {
        success: false,
        providerMessageId: null,
        status: SmsStatus.FAILED,
        errorCode: 'MISSING_DLT_TEMPLATE',
        errorMessage: `No DLT template ID configured for ${params.templateKey}. Set the matching MSG91_TEMPLATE_* variable.`,
        rawResponse: null,
        segments,
      };
    }

    // MSG91 wants the number without the leading '+'.
    const recipient = params.to.replace(/^\+/, '');

    const payload = {
      template_id: templateId,
      short_url: '0',
      recipients: [
        {
          mobiles: recipient,
          ...(params.variables ?? {}),
        },
      ],
      ...(this.senderId ? { sender: this.senderId } : {}),
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(`${MSG91_BASE_URL}/v5/flow/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: this.authKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const raw: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message = extractMessage(raw) ?? `HTTP ${response.status}`;
        log.error({ status: response.status, raw }, 'MSG91 rejected the send');
        return {
          success: false,
          providerMessageId: null,
          status: SmsStatus.FAILED,
          errorCode: `HTTP_${response.status}`,
          errorMessage: message,
          rawResponse: raw,
          segments,
        };
      }

      // MSG91 returns HTTP 200 with {type:"error"} on business failures,
      // so the status code alone is not sufficient to declare success.
      const body = raw as { type?: string; message?: string } | null;

      if (body?.type === 'error') {
        return {
          success: false,
          providerMessageId: null,
          status: SmsStatus.FAILED,
          errorCode: 'PROVIDER_ERROR',
          errorMessage: body.message ?? 'MSG91 returned an error',
          rawResponse: raw,
          segments,
        };
      }

      const messageId =
        typeof body?.message === 'string' ? body.message : null;

      return {
        success: true,
        providerMessageId: messageId,
        status: SmsStatus.SENT,
        errorCode: null,
        errorMessage: null,
        rawResponse: raw,
        segments,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message : String(error);

      log.error({ err: message }, 'MSG91 request failed');

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
        `${MSG91_BASE_URL}/v5/report/${encodeURIComponent(providerMessageId)}`,
        { headers: { authkey: this.authKey } },
      );

      const raw = (await response.json().catch(() => null)) as {
        data?: { status?: string; date?: string };
      } | null;

      const status = raw?.data?.status ?? 'UNKNOWN';
      const delivered = status.toUpperCase() === 'DELIVERED';

      return {
        delivered,
        status,
        ...(delivered && raw?.data?.date
          ? { deliveredAt: new Date(raw.data.date) }
          : {}),
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
    if (!this.authKey) {
      return { ok: false, message: 'MSG91_AUTH_KEY is not set' };
    }

    const missing = (
      [
        [SmsTemplateKey.WELCOME, env.MSG91_TEMPLATE_WELCOME],
        [SmsTemplateKey.EXPIRY_REMINDER, env.MSG91_TEMPLATE_EXPIRY],
        [SmsTemplateKey.DUES_REMINDER, env.MSG91_TEMPLATE_DUES],
      ] as const
    )
      .filter(([, id]) => !id)
      .map(([key]) => key);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing DLT template IDs for: ${missing.join(', ')}. These messages will fail to send.`,
      };
    }

    return { ok: true, message: 'MSG91 configured with DLT templates.' };
  }
}

function extractMessage(raw: unknown): string | null {
  if (typeof raw === 'object' && raw !== null && 'message' in raw) {
    const message = (raw as { message: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return null;
}
