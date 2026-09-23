import {
  WHATSAPP_TEMPLATES,
  WhatsAppTemplateKey,
  renderWhatsAppTemplate,
  toWhatsAppParameters,
} from '@azf/shared';
import { describe, expect, it } from 'vitest';
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

  it('verifies as configured', async () => {
    const result = await new MockWhatsAppProvider().verifyConfiguration();
    expect(result.ok).toBe(true);
  });
});
