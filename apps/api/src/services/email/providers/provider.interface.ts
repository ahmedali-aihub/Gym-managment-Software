import type { EmailTemplateKey } from '@azf/shared';

/**
 * The contract every email provider adapter implements.
 *
 * Mirrors the SMS adapter contract, and for the same reason: nothing outside
 * this folder imports a concrete provider, so moving from Gmail SMTP to Brevo
 * is an env change and a restart.
 *
 * Adapters MUST NOT throw. A refused connection or a rate limit is an
 * expected condition to be recorded and retried — never an exception that
 * aborts the member registration that triggered the email.
 */
export interface EmailProviderAdapter {
  readonly name: string;

  /**
   * Attempt delivery of one message.
   * MUST resolve — never reject. Failures come back as `success: false`.
   */
  send(params: EmailSendParams): Promise<EmailSendResult>;

  /** Called at boot so a misconfigured provider surfaces before first send. */
  verifyConfiguration(): Promise<{ ok: boolean; message: string }>;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailSendParams {
  to: string;
  subject: string;
  /** Rendered HTML. */
  html: string;
  /** Plain-text alternative. Improves spam scoring; some clients show only this. */
  text: string;
  templateKey: EmailTemplateKey;
  attachments?: EmailAttachment[] | undefined;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string | undefined;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  /**
   * Whether retrying could plausibly succeed. A bad recipient address never
   * will; a timeout might. The worker uses this to decide between scheduling
   * a retry and marking the message DEAD.
   */
  retryable?: boolean | undefined;
  rawResponse?: unknown;
}
