import { SmsStatus, countSmsSegments, type SmsSendResult } from '@azf/shared';
import { env } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  SmsProviderAdapter,
  SmsSendParams,
} from './provider.interface.js';

const log = moduleLogger('sms:fast2sms');
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Fast2SMS adapter — a lower-cost Indian alternative to MSG91.
 *
 * Uses the DLT manual route, which requires both the DLT entity ID and the
 * approved message text. Fast2SMS exposes no delivery-status API on this
 * route, so `getStatus` is deliberately not implemented; the SMS service
 * treats SENT as terminal for this provider.
 */
export class Fast2SmsProvider implements SmsProviderAdapter {
  readonly name = 'FAST2SMS';

  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly entityId: string | undefined;

  constructor() {
    this.apiKey = env.FAST2SMS_API_KEY ?? '';
    this.senderId = env.SMS_SENDER_ID;
    this.entityId = env.DLT_ENTITY_ID;
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    const { segments } = countSmsSegments(params.body);

    // Fast2SMS takes bare 10-digit numbers.
    const recipient = params.to.replace(/^\+91/, '');

    const body = {
      route: 'dlt_manual',
      sender_id: this.senderId,
      message: params.body,
      numbers: recipient,
      ...(this.entityId ? { entity_id: this.entityId } : {}),
      ...(params.dltTemplateId ? { template_id: params.dltTemplateId } : {}),
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const raw = (await response.json().catch(() => null)) as {
        return?: boolean;
        request_id?: string;
        message?: string | string[];
      } | null;

      const failureMessage = Array.isArray(raw?.message)
        ? raw.message.join('; ')
        : raw?.message;

      if (!response.ok || raw?.return !== true) {
        log.error({ status: response.status, raw }, 'Fast2SMS rejected the send');
        return {
          success: false,
          providerMessageId: null,
          status: SmsStatus.FAILED,
          errorCode: `HTTP_${response.status}`,
          errorMessage: failureMessage ?? `HTTP ${response.status}`,
          rawResponse: raw,
          segments,
        };
      }

      return {
        success: true,
        providerMessageId: raw.request_id ?? null,
        status: SmsStatus.SENT,
        errorCode: null,
        errorMessage: null,
        rawResponse: raw,
        segments,
      };
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: message }, 'Fast2SMS request failed');

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

  async verifyConfiguration(): Promise<{ ok: boolean; message: string }> {
    if (!this.apiKey) {
      return { ok: false, message: 'FAST2SMS_API_KEY is not set' };
    }
    if (!this.entityId) {
      return {
        ok: false,
        message: 'DLT_ENTITY_ID is required for the Fast2SMS DLT route',
      };
    }
    return { ok: true, message: 'Fast2SMS configured.' };
  }
}
