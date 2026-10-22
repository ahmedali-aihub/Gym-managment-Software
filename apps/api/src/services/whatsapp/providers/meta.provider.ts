import { env } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import type {
  WhatsAppDocument,
  WhatsAppProviderAdapter,
  WhatsAppSendParams,
  WhatsAppSendResult,
} from './provider.interface.js';

const log = moduleLogger('whatsapp:meta');

/**
 * Meta WhatsApp Cloud API.
 *
 * Needs, in this order:
 *   1. A Meta Business account, verified.
 *   2. A WhatsApp Business phone number — one NOT already registered on the
 *      consumer WhatsApp app. This is the step that most often blocks a gym:
 *      the number they already message members from cannot be reused without
 *      first deleting that WhatsApp account.
 *   3. Each template submitted and approved under category UTILITY.
 *
 * Utility templates are cheaper than marketing ones and are not subject to
 * the per-user marketing frequency cap, which matters for receipts.
 */
export class MetaWhatsAppProvider implements WhatsAppProviderAdapter {
  readonly name = 'meta';

  private get endpoint(): string {
    return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  }

  async send(params: WhatsAppSendParams): Promise<WhatsAppSendResult> {
    try {
      // A document header needs the file on Meta's side first. Uploading it
      // keeps the receipt — name, phone, amounts — off any public URL, which
      // is what the link-based alternative would need.
      let media: { id: string; filename: string } | undefined;
      if (params.document) {
        const uploaded = await this.uploadDocument(params.document);
        if ('failure' in uploaded) return uploaded.failure;
        media = { id: uploaded.id, filename: params.document.filename };
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          // Meta wants the number WITHOUT a leading +, despite documenting
          // it as E.164. Sending the + yields a misleading "invalid
          // recipient" rather than a format error.
          to: params.to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: params.metaTemplateName,
            language: { code: params.languageCode },
            components: templateComponents(params.parameters, media),
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const payload = (await response.json()) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number; error_subcode?: number };
      };

      if (!response.ok || payload.error) {
        const code = String(payload.error?.code ?? response.status);
        const message = payload.error?.message ?? `HTTP ${response.status}`;

        log.error({ code, message, to: params.to }, 'WhatsApp send failed');

        return {
          success: false,
          errorCode: code,
          errorMessage: describeMetaError(code, message),
          retryable: isRetryable(code, response.status),
          rawResponse: payload,
        };
      }

      return {
        success: true,
        providerMessageId: payload.messages?.[0]?.id,
        rawResponse: payload,
      };
    } catch (error) {
      // A timeout or a DNS failure is transient by nature.
      const message = error instanceof Error ? error.message : String(error);
      log.error({ err: error, to: params.to }, 'WhatsApp request failed');

      return {
        success: false,
        errorCode: 'REQUEST_FAILED',
        errorMessage: message,
        retryable: true,
        rawResponse: { error: message },
      };
    }
  }

  /**
   * Upload a PDF to Meta for one message. The returned media id stays valid
   * for 30 days, far longer than any retry schedule.
   */
  private async uploadDocument(
    document: WhatsAppDocument,
  ): Promise<{ id: string } | { failure: WhatsAppSendResult }> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append(
      'file',
      new Blob([new Uint8Array(document.content)], { type: 'application/pdf' }),
      document.filename,
    );

    const response = await fetch(
      `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN ?? ''}` },
        body: form,
        signal: AbortSignal.timeout(20_000),
      },
    );

    const payload = (await response.json()) as {
      id?: string;
      error?: { message?: string; code?: number };
    };

    if (!response.ok || payload.error || !payload.id) {
      const code = String(payload.error?.code ?? response.status);
      const message = payload.error?.message ?? `HTTP ${response.status}`;

      log.error({ code, message }, 'WhatsApp receipt upload failed');

      return {
        failure: {
          success: false,
          errorCode: code,
          errorMessage: `Receipt upload failed: ${describeMetaError(code, message)}`,
          retryable: isRetryable(code, response.status),
          rawResponse: payload,
        },
      };
    }

    return { id: payload.id };
  }

  async verifyConfiguration(): Promise<{ ok: boolean; message: string }> {
    if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      return {
        ok: false,
        message:
          'WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required',
      };
    }

    try {
      // Reading the phone number's own record proves both the token and the
      // id, without sending a message to anybody.
      const response = await fetch(
        `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`,
        {
          headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` },
          signal: AbortSignal.timeout(10_000),
        },
      );

      const payload = (await response.json()) as {
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string };
      };

      if (!response.ok || payload.error) {
        return {
          ok: false,
          message: payload.error?.message ?? `HTTP ${response.status}`,
        };
      }

      return {
        ok: true,
        message: `connected as ${payload.verified_name ?? 'unknown'} (${payload.display_phone_number ?? '—'})`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * The `components` of a template message: the receipt as the DOCUMENT
 * header when there is one, then the body variables in template order.
 */
export function templateComponents(
  parameters: string[],
  document?: { id: string; filename: string },
): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];

  if (document) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'document',
          document: { id: document.id, filename: document.filename },
        },
      ],
    });
  }

  if (parameters.length) {
    components.push({
      type: 'body',
      parameters: parameters.map((text) => ({ type: 'text', text })),
    });
  }

  return components;
}

/**
 * Translate Meta's error codes into something a gym owner could act on.
 *
 * The raw messages are written for developers — "(#132001) Template name
 * does not exist" says nothing about needing to submit it for approval.
 */
function describeMetaError(code: string, fallback: string): string {
  switch (code) {
    case '132001':
      return 'Template not found or not approved yet. Submit it in WhatsApp Manager and wait for approval.';
    case '132000':
      return 'Template variable count does not match the approved template.';
    case '132012':
      return 'The message does not match its approved template. A template ending in _pdf must be approved with a Document header; the others without one.';
    case '131053':
      return 'WhatsApp could not accept the receipt PDF.';
    case '131026':
      return 'This number cannot receive WhatsApp messages.';
    case '131047':
      return 'Outside the 24-hour window and no approved template was used.';
    case '190':
      return 'Access token expired or invalid. Generate a new permanent token.';
    case '80007':
    case '4':
      return 'Rate limit reached; this will be retried.';
    default:
      return fallback;
  }
}

/** Whether a retry could plausibly succeed. */
function isRetryable(code: string, status: number): boolean {
  // An unapproved template or a bad token fails identically every time;
  // retrying only delays the error the owner needs to see.
  if (['132001', '132000', '132012', '131026', '190'].includes(code)) {
    return false;
  }
  return status >= 500 || ['80007', '4', '131056'].includes(code);
}
