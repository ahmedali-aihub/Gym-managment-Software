import { randomUUID } from 'node:crypto';
import type { WhatsAppTemplateKey } from '@azf/shared';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  WhatsAppProviderAdapter,
  WhatsAppSendParams,
  WhatsAppSendResult,
} from './provider.interface.js';

const log = moduleLogger('whatsapp:mock');

interface MockMessage {
  id: string;
  to: string;
  templateKey: WhatsAppTemplateKey;
  body: string;
  sentAt: Date;
}

/**
 * Mock WhatsApp provider.
 *
 * The default until Meta business verification completes, and the one the
 * tests run against. It prints the rendered message so the exact text a
 * member would receive can be read in the logs — a template that has only
 * ever been asserted against in a string comparison is one nobody has seen.
 */
export class MockWhatsAppProvider implements WhatsAppProviderAdapter {
  readonly name = 'mock';

  private readonly outbox: MockMessage[] = [];

  async send(params: WhatsAppSendParams): Promise<WhatsAppSendResult> {
    const messageId = `wamock_${randomUUID()}`;

    this.outbox.push({
      id: messageId,
      to: params.to,
      templateKey: params.templateKey,
      body: params.body,
      sentAt: new Date(),
    });

    log.info(
      `\n┌─ MOCK WHATSAPP ─────────────────────────────────────\n` +
        `│ To:       ${params.to}\n` +
        `│ Template: ${params.metaTemplateName} (${params.templateKey})\n` +
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
      rawResponse: { provider: 'mock', messageId },
    };
  }

  async verifyConfiguration(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: true,
      message: 'mock provider — messages are logged, not sent',
    };
  }

  /** Test helpers. */
  getOutbox(): readonly MockMessage[] {
    return this.outbox;
  }

  clearOutbox(): void {
    this.outbox.length = 0;
  }
}
