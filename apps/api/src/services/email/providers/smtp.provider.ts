import nodemailer, { type Transporter } from 'nodemailer';
import { emailConfig, env } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  EmailProviderAdapter,
  EmailSendParams,
  EmailSendResult,
} from './provider.interface.js';

const log = moduleLogger('email:smtp');

/**
 * SMTP provider — covers Gmail, and any other host that speaks SMTP.
 *
 * GMAIL NEEDS AN APP PASSWORD, not the account password. Google has refused
 * plain passwords for SMTP since 2022; using one fails with a confusing
 * "Username and Password not accepted". Generate one at
 * myaccount.google.com → Security → 2-Step Verification → App passwords.
 *
 * Gmail's free tier allows roughly 500 messages a day, which at ~27 new
 * members a month is far more headroom than this gym needs. If reminders
 * later push against that ceiling, switching to Brevo is an env change.
 */
export class SmtpEmailProvider implements EmailProviderAdapter {
  readonly name = 'smtp';

  private transporter: Transporter | null = null;

  /**
   * Built lazily and reused.
   *
   * `pool: true` keeps connections open between sends — Gmail throttles
   * aggressively when a client reconnects for every message, and a welcome
   * email plus its receipt is two round trips that should share one link.
   */
  private getTransporter(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // Port 465 is implicit TLS; 587 upgrades via STARTTLS. Getting this
      // backwards hangs until timeout rather than failing cleanly.
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER ?? '',
        pass: env.SMTP_PASSWORD ?? '',
      },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });

    return this.transporter;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    try {
      const info = await this.getTransporter().sendMail({
        from: `"${emailConfig.fromName}" <${emailConfig.fromAddress}>`,
        replyTo: emailConfig.replyTo,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        attachments: params.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      });

      log.info(
        { to: params.to, messageId: info.messageId },
        'Email sent via SMTP',
      );

      return {
        success: true,
        providerMessageId: info.messageId,
        rawResponse: {
          accepted: info.accepted,
          rejected: info.rejected,
          response: info.response,
        },
      };
    } catch (error) {
      const { code, message } = describeSmtpError(error);

      log.error({ err: error, to: params.to, code }, 'SMTP send failed');

      return {
        success: false,
        errorCode: code,
        errorMessage: message,
        retryable: isRetryable(code),
        rawResponse: { error: String(error) },
      };
    }
  }

  async verifyConfiguration(): Promise<{ ok: boolean; message: string }> {
    if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
      return {
        ok: false,
        message: 'SMTP_USER and SMTP_PASSWORD are not set',
      };
    }

    try {
      await this.getTransporter().verify();
      return {
        ok: true,
        message: `connected to ${env.SMTP_HOST}:${env.SMTP_PORT} as ${env.SMTP_USER}`,
      };
    } catch (error) {
      const { message } = describeSmtpError(error);
      return { ok: false, message };
    }
  }

  /** Release pooled connections on shutdown. */
  close(): void {
    this.transporter?.close();
    this.transporter = null;
  }
}

/**
 * Translate nodemailer's error into something a gym owner could act on.
 *
 * The raw errors are cryptic — "EAUTH 535" tells you nothing about needing
 * an App Password, which is the actual cause nine times out of ten.
 */
function describeSmtpError(error: unknown): {
  code: string;
  message: string;
} {
  const err = error as { code?: string; responseCode?: number; message?: string };
  const code = err.code ?? (err.responseCode ? `SMTP_${err.responseCode}` : 'UNKNOWN');

  if (code === 'EAUTH' || err.responseCode === 535) {
    return {
      code: 'AUTH_FAILED',
      message:
        'SMTP authentication failed. For Gmail, SMTP_PASSWORD must be a 16-character App Password, not the account password.',
    };
  }

  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return {
      code: 'CONNECTION_FAILED',
      message: `Could not reach the mail server (${code}). Check SMTP_HOST, SMTP_PORT and that the network allows outbound SMTP.`,
    };
  }

  if (err.responseCode === 550 || err.responseCode === 553) {
    return {
      code: 'RECIPIENT_REJECTED',
      message: 'The recipient address was rejected by the mail server.',
    };
  }

  if (err.responseCode === 421 || err.responseCode === 450) {
    return {
      code: 'RATE_LIMITED',
      message: 'The mail server is throttling; this will be retried.',
    };
  }

  return { code, message: err.message ?? 'Unknown SMTP error' };
}

/**
 * Whether a retry could plausibly succeed.
 *
 * A rejected recipient or a wrong password will fail identically on every
 * attempt — retrying those just delays the failure the owner needs to see,
 * and against Gmail it burns quota.
 */
function isRetryable(code: string): boolean {
  return code === 'CONNECTION_FAILED' || code === 'RATE_LIMITED';
}
