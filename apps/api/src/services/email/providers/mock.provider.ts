import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { EmailTemplateKey } from '@azf/shared';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  EmailProviderAdapter,
  EmailSendParams,
  EmailSendResult,
} from './provider.interface.js';

const log = moduleLogger('email:mock');

interface MockEmail {
  id: string;
  to: string;
  subject: string;
  templateKey: EmailTemplateKey;
  attachments: string[];
  sentAt: Date;
}

/**
 * Mock email provider.
 *
 * The default until real credentials are configured, and the one the tests
 * run against. It writes each message to disk as an .html file so the layout
 * can be opened in a browser and actually LOOKED AT — an email template that
 * has only ever been asserted against in a string comparison is a template
 * nobody has seen.
 *
 * Writing is best-effort: a failed write logs and the send still succeeds,
 * because a missing preview file is not a delivery failure.
 */
export class MockEmailProvider implements EmailProviderAdapter {
  readonly name = 'mock';

  private readonly outbox: MockEmail[] = [];
  private readonly previewDir: string;
  private readonly writePreviews: boolean;

  constructor(options: { previewDir?: string; writePreviews?: boolean } = {}) {
    this.previewDir = options.previewDir ?? path.resolve('./tmp/email-preview');
    // Off in tests: writing a file per email would litter the repo and slow
    // the suite for no assertion.
    this.writePreviews = options.writePreviews ?? true;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const messageId = `mock_${randomUUID()}`;
    const attachments = (params.attachments ?? []).map((a) => a.filename);

    this.outbox.push({
      id: messageId,
      to: params.to,
      subject: params.subject,
      templateKey: params.templateKey,
      attachments,
      sentAt: new Date(),
    });

    let previewPath: string | null = null;
    if (this.writePreviews) {
      previewPath = await this.writePreview(messageId, params);
    }

    log.info(
      `\n┌─ MOCK EMAIL ────────────────────────────────────────\n` +
        `│ To:       ${params.to}\n` +
        `│ Subject:  ${params.subject}\n` +
        `│ Template: ${params.templateKey}\n` +
        (attachments.length
          ? `│ Attached: ${attachments.join(', ')}\n`
          : '') +
        (previewPath ? `│ Preview:  ${previewPath}\n` : '') +
        `├─────────────────────────────────────────────────────\n` +
        params.text
          .split('\n')
          .map((line) => `│ ${line}`)
          .join('\n') +
        `\n└─────────────────────────────────────────────────────`,
    );

    return {
      success: true,
      providerMessageId: messageId,
      rawResponse: { provider: 'mock', messageId, previewPath },
    };
  }

  private async writePreview(
    messageId: string,
    params: EmailSendParams,
  ): Promise<string | null> {
    try {
      await mkdir(this.previewDir, { recursive: true });
      const file = path.join(this.previewDir, `${messageId}.html`);
      await writeFile(file, params.html, 'utf8');
      return file;
    } catch (error) {
      log.warn({ err: error }, 'Could not write email preview');
      return null;
    }
  }

  async verifyConfiguration(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: true,
      message: this.writePreviews
        ? `mock provider — messages written to ${this.previewDir}`
        : 'mock provider — previews disabled',
    };
  }

  /** Test helpers. */
  getOutbox(): readonly MockEmail[] {
    return this.outbox;
  }

  clearOutbox(): void {
    this.outbox.length = 0;
  }
}
