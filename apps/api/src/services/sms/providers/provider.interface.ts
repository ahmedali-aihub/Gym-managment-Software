import type { SmsSendResult, SmsTemplateKey } from '@azf/shared';

/**
 * The contract every SMS provider adapter implements.
 *
 * The rest of the application never imports a concrete provider — it depends
 * only on this interface, which is why swapping MSG91 for Twilio is a one-line
 * env change. Adapters are responsible for translating their own wire format
 * into SmsSendResult and for never throwing: a provider outage is an expected
 * condition that must be recorded and retried, not an exception that aborts a
 * member registration.
 */
export interface SmsProviderAdapter {
  readonly name: string;

  /**
   * Attempt delivery of one message.
   * MUST resolve — never reject. Failures come back as `success: false`.
   */
  send(params: SmsSendParams): Promise<SmsSendResult>;

  /**
   * Poll delivery status, where the provider supports it.
   * Undefined on providers with no status API.
   */
  getStatus?(providerMessageId: string): Promise<SmsDeliveryStatus>;

  /** Called at boot so a misconfigured provider surfaces before first send. */
  verifyConfiguration(): Promise<{ ok: boolean; message: string }>;
}

export interface SmsSendParams {
  /** E.164, e.g. +919876543210. */
  to: string;
  body: string;
  templateKey: SmsTemplateKey;
  /**
   * DLT-approved template ID. Mandatory for transactional SMS in India —
   * operators drop messages whose content does not match a registered
   * template. Resolved per provider from env config.
   */
  dltTemplateId?: string | undefined;
  /** Template variables, for providers that substitute server-side. */
  variables?: Record<string, string | number> | undefined;
  senderId?: string | undefined;
}

export interface SmsDeliveryStatus {
  delivered: boolean;
  status: string;
  deliveredAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}
