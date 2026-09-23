import type { WhatsAppTemplateKey } from '@azf/shared';

/**
 * The contract every WhatsApp provider adapter implements.
 *
 * Mirrors the SMS and email adapters, and for the same reason: nothing
 * outside this folder imports a concrete provider, so activating Meta once
 * business verification completes is an env change and a restart.
 *
 * Adapters MUST NOT throw. A rejected template or a rate limit is an
 * expected condition to be recorded and retried — never an exception that
 * aborts the registration or payment that triggered it.
 */
export interface WhatsAppProviderAdapter {
  readonly name: string;

  /**
   * Attempt delivery of one message.
   * MUST resolve — never reject. Failures come back as `success: false`.
   */
  send(params: WhatsAppSendParams): Promise<WhatsAppSendResult>;

  /** Called at boot so a misconfigured provider surfaces before first send. */
  verifyConfiguration(): Promise<{ ok: boolean; message: string }>;
}

export interface WhatsAppSendParams {
  /** E.164, e.g. +919876543210 — the only form Meta accepts. */
  to: string;
  templateKey: WhatsAppTemplateKey;
  /** Meta's approved template name, e.g. azf_welcome. */
  metaTemplateName: string;
  /** Positional variables, in template order. */
  parameters: string[];
  /** Rendered body, for logging and the mock provider's output. */
  body: string;
  /** BCP-47 language of the approved template, e.g. en. */
  languageCode: string;
}

export interface WhatsAppSendResult {
  success: boolean;
  providerMessageId?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  /**
   * Whether retrying could plausibly succeed. An unapproved template never
   * will; a rate limit might. The worker uses this to choose between a retry
   * and marking the message DEAD.
   */
  retryable?: boolean | undefined;
  rawResponse?: unknown;
}
