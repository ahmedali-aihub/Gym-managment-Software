import {
  WHATSAPP_TEMPLATES,
  WhatsAppTemplateKey,
  renderWhatsAppTemplate,
  toWhatsAppParameters,
} from '@azf/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  MetaWhatsAppProvider,
  templateComponents,
} from '../../src/services/whatsapp/providers/meta.provider.js';
import { MockWhatsAppProvider } from '../../src/services/whatsapp/providers/mock.provider.js';

/**
 * WhatsApp template tests.
 *
 * Meta numbers its variables positionally, which makes one failure mode
 * uniquely nasty: a missing value does not error, it SHIFTS every later
 * variable up by one. The member receives a plausible message with their
 * plan where their name should be, and nothing anywhere reports a problem.
 */

describe('WhatsApp templates', () => {
  it('declares a name for every {{n}} the body uses', () => {
    for (const template of Object.values(WHATSAPP_TEMPLATES)) {
      const indexes = [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
        Number(m[1]),
      );
      const highest = Math.max(...indexes);

      expect(
        template.variables.length,
        `${template.key} uses {{${highest}}} but declares ${template.variables.length} variables`,
      ).toBe(highest);
    }
  });

  it('numbers variables from 1 with no gaps', () => {
    // Meta rejects a template whose placeholders skip a number.
    for (const template of Object.values(WHATSAPP_TEMPLATES)) {
      const indexes = [
        ...new Set(
          [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])),
        ),
      ].sort((a, b) => a - b);

      expect(indexes, `${template.key} has gaps`).toEqual(
        indexes.map((_, i) => i + 1),
      );
    }
  });

  it('gives every template a Meta name in snake_case', () => {
    for (const template of Object.values(WHATSAPP_TEMPLATES)) {
      expect(template.metaName).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('passes Meta\'s placement rules, which reject templates outright', () => {
    for (const template of Object.values(WHATSAPP_TEMPLATES)) {
      const body = template.body.trim();
      const order = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

      // A placeholder can expand to many words, so Meta refuses one at
      // either end of the body.
      expect(body, `${template.key} starts with a variable`).not.toMatch(/^\{\{\d+\}\}/);
      expect(body, `${template.key} ends with a variable`).not.toMatch(/\{\{\d+\}\}\W*$/);
      // Numbered in reading order, and never two placeholders back to back.
      expect(order, `${template.key} variables out of order`).toEqual(
        [...order].sort((a, b) => a - b),
      );
      expect(body, `${template.key} has adjacent variables`).not.toMatch(
        /\}\}\s*\{\{/,
      );
    }
  });

  it('registers the receipt version under its own snake_case name', () => {
    // Meta fixes the header when it approves a template, so the version with
    // the PDF must be a separate template, never the plain one renamed.
    for (const template of Object.values(WHATSAPP_TEMPLATES)) {
      if (!template.receiptMetaName) continue;
      expect(template.receiptMetaName).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(template.receiptMetaName).not.toBe(template.metaName);
    }
    expect(WHATSAPP_TEMPLATES.WELCOME.receiptMetaName).toBeDefined();
    expect(WHATSAPP_TEMPLATES.PAYMENT_RECEIPT.receiptMetaName).toBeDefined();
  });
});

describe('templateComponents (Meta payload)', () => {
  it('puts the receipt in a DOCUMENT header before the body', () => {
    const components = templateComponents(['Aarav', '2,100'], {
      id: 'media-123',
      filename: 'Receipt-RCPT-2026-27-0001.pdf',
    });

    expect(components).toEqual([
      {
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: {
              id: 'media-123',
              filename: 'Receipt-RCPT-2026-27-0001.pdf',
            },
          },
        ],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Aarav' },
          { type: 'text', text: '2,100' },
        ],
      },
    ]);
  });

  it('sends no header for a plain template', () => {
    const components = templateComponents(['Aarav']);
    expect(components).toHaveLength(1);
    expect(components[0]!.type).toBe('body');
  });
});

describe('MetaWhatsAppProvider with a receipt', () => {
  const receipt = {
    filename: 'Receipt-RCPT-2026-27-0001.pdf',
    content: Buffer.from('%PDF-1.4 test'),
  };
  const message = {
    to: '+919876543210',
    templateKey: WhatsAppTemplateKey.WELCOME,
    metaTemplateName: 'azf_welcome_pdf',
    parameters: ['A to Z Fitness', 'Aarav'],
    body: 'Welcome to A to Z Fitness, Aarav!',
    languageCode: 'en',
    document: receipt,
  };

  it('uploads the PDF, then sends the template with it as the header', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url, init) => {
        calls.push({ url: String(url), init });
        const reply = String(url).endsWith('/media')
          ? { id: 'media-42' }
          : { messages: [{ id: 'wamid.1' }] };
        return new Response(JSON.stringify(reply), { status: 200 });
      });

    try {
      const result = await new MetaWhatsAppProvider().send(message);

      expect(result.success).toBe(true);
      expect(calls).toHaveLength(2);

      // 1. The receipt goes up privately, as a file — never as a public link.
      expect(calls[0]!.url).toMatch(/\/media$/);
      const form = calls[0]!.init!.body as FormData;
      expect(form.get('messaging_product')).toBe('whatsapp');
      expect(form.get('type')).toBe('application/pdf');
      expect((form.get('file') as File).name).toBe(receipt.filename);

      // 2. The message names the PDF template and carries the media id.
      const sent = JSON.parse(String(calls[1]!.init!.body)) as {
        to: string;
        template: { name: string; components: unknown[] };
      };
      expect(sent.to).toBe('919876543210');
      expect(sent.template.name).toBe('azf_welcome_pdf');
      expect(sent.template.components[0]).toEqual({
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: { id: 'media-42', filename: receipt.filename },
          },
        ],
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('does not send the message when the upload fails', async () => {
    const urls: string[] = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        urls.push(String(url));
        return new Response(
          JSON.stringify({ error: { code: 131053, message: 'Media upload error' } }),
          { status: 400 },
        );
      });

    try {
      const result = await new MetaWhatsAppProvider().send(message);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('131053');
      expect(result.errorMessage).toMatch(/^Receipt upload failed/);
      // Only the upload was attempted; no message went out without its PDF.
      expect(urls).toHaveLength(1);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('toWhatsAppParameters', () => {
  const template = WHATSAPP_TEMPLATES.WELCOME;

  it('returns values in TEMPLATE order, not object order', () => {
    const parameters = toWhatsAppParameters(template, {
      // Deliberately scrambled relative to the template.
      amount: '4,000',
      name: 'Aarav',
      gymName: 'A to Z Fitness',
      gymPhone: '+919000000000',
      memberId: 'AZF-2026-0042',
      plan: 'Quarterly',
      expiryDate: '21/12/2026',
    });

    expect(parameters).toEqual([
      'A to Z Fitness',
      'Aarav',
      'AZF-2026-0042',
      'Quarterly',
      '21/12/2026',
      '4,000',
      '+919000000000',
    ]);
  });

  it('holds the position of a missing value rather than dropping it', () => {
    // Dropping it shifts every later variable up by one, and the member
    // gets a message with their plan where their expiry date belongs.
    const parameters = toWhatsAppParameters(template, {
      gymName: 'A to Z Fitness',
      name: 'Aarav',
      // memberId deliberately absent
      plan: 'Quarterly',
      expiryDate: '21/12/2026',
      amount: '4,000',
      gymPhone: '+919000000000',
    });

    expect(parameters).toHaveLength(7);
    expect(parameters[2]).toBe('');
    expect(parameters[3]).toBe('Quarterly');
  });

  it('stringifies numbers', () => {
    const parameters = toWhatsAppParameters(WHATSAPP_TEMPLATES.PAYMENT_DUE, {
      name: 'Aarav',
      memberId: 'AZF-2026-0042',
      amount: 500,
      gymName: 'A to Z Fitness',
      gymPhone: '+919000000000',
    });
    expect(parameters[2]).toBe('500');
  });
});

describe('renderWhatsAppTemplate', () => {
  it('substitutes every placeholder', () => {
    const body = renderWhatsAppTemplate(WHATSAPP_TEMPLATES.WELCOME, {
      gymName: 'A to Z Fitness',
      name: 'Aarav',
      memberId: 'AZF-2026-0042',
      plan: 'Quarterly',
      expiryDate: '21/12/2026',
      amount: '4,000',
      gymPhone: '+919000000000',
    });

    expect(body).not.toMatch(/\{\{/);
    expect(body).toContain('Aarav');
    expect(body).toContain('AZF-2026-0042');
  });
});

describe('MockWhatsAppProvider', () => {
  it('records the message and reports success', async () => {
    const provider = new MockWhatsAppProvider();

    const result = await provider.send({
      to: '+919876543210',
      templateKey: WhatsAppTemplateKey.WELCOME,
      metaTemplateName: 'azf_welcome',
      parameters: ['A to Z Fitness', 'Aarav'],
      body: 'Welcome to A to Z Fitness, Aarav!',
      languageCode: 'en',
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toMatch(/^wamock_/);
    expect(provider.getOutbox()).toHaveLength(1);
    expect(provider.getOutbox()[0]!.to).toBe('+919876543210');
  });

  it('records an attached receipt', async () => {
    const provider = new MockWhatsAppProvider();

    await provider.send({
      to: '+919876543210',
      templateKey: WhatsAppTemplateKey.WELCOME,
      metaTemplateName: 'azf_welcome_pdf',
      parameters: ['A to Z Fitness', 'Aarav'],
      body: 'Welcome to A to Z Fitness, Aarav!',
      languageCode: 'en',
      document: {
        filename: 'Receipt-RCPT-2026-27-0001.pdf',
        content: Buffer.from('%PDF-1.4 test'),
      },
    });

    expect(provider.getOutbox()[0]!.document).toEqual({
      filename: 'Receipt-RCPT-2026-27-0001.pdf',
      bytes: 13,
    });
  });

  it('verifies as configured', async () => {
    const result = await new MockWhatsAppProvider().verifyConfiguration();
    expect(result.ok).toBe(true);
  });
});
