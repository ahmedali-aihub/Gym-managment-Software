import {
  EMAIL_TEMPLATES,
  EmailTemplateKey,
  renderEmailTemplate,
} from '@azf/shared';
import { describe, expect, it } from 'vitest';
import { MockEmailProvider } from '../../src/services/email/providers/mock.provider.js';

/**
 * Email template and provider tests.
 *
 * The two things that go wrong silently here:
 *
 *  - An unescaped variable breaks the HTML. A member called "Raj & Sons"
 *    would corrupt the markup, and worse, an address field is an injection
 *    route into whatever renders it.
 *  - A missing variable renders as a literal {{name}} in the member's inbox.
 *    That is not a crash, so nothing catches it but a test.
 */

describe('email templates', () => {
  it('declares every variable its body actually uses', () => {
    // A variable used but not declared is one no caller knows to pass, which
    // ships "{{memberId}}" to a real member.
    for (const template of Object.values(EMAIL_TEMPLATES)) {
      const used = new Set(
        [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!),
      );
      const usedInText = new Set(
        [...template.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!),
      );
      const usedInSubject = new Set(
        [...template.subject.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!),
      );

      for (const variable of [...used, ...usedInText, ...usedInSubject]) {
        expect(
          template.variables,
          `${template.key} uses {{${variable}}} but does not declare it`,
        ).toContain(variable);
      }
    }
  });

  it('ships a plain-text alternative for every template', () => {
    // Some clients render only the text part, and its absence measurably
    // worsens spam scoring.
    for (const template of Object.values(EMAIL_TEMPLATES)) {
      expect(template.text.length, `${template.key} has no text part`)
        .toBeGreaterThan(40);
      expect(template.text).not.toContain('<');
    }
  });

  it('uses inline styles only — Gmail strips <style> blocks', () => {
    for (const template of Object.values(EMAIL_TEMPLATES)) {
      expect(
        template.body,
        `${template.key} has a <style> block, which Gmail discards`,
      ).not.toMatch(/<style[\s>]/i);
    }
  });

  it('leaves no unsubstituted placeholder when all variables are given', () => {
    const template = EMAIL_TEMPLATES.WELCOME;
    const variables: Record<string, string> = {};
    for (const key of template.variables) variables[key] = 'x';

    const html = renderEmailTemplate(template.body, variables);
    const subject = renderEmailTemplate(template.subject, variables, false);
    const text = renderEmailTemplate(template.text, variables, false);

    expect(html).not.toMatch(/\{\{/);
    expect(subject).not.toMatch(/\{\{/);
    expect(text).not.toMatch(/\{\{/);
  });
});

describe('renderEmailTemplate', () => {
  it('escapes HTML in values so a name cannot break the markup', () => {
    const out = renderEmailTemplate('<p>Hi {{name}}</p>', {
      name: 'Raj & <b>Sons</b>',
    });

    expect(out).toBe('<p>Hi Raj &amp; &lt;b&gt;Sons&lt;/b&gt;</p>');
    expect(out).not.toContain('<b>');
  });

  it('escapes quotes, which would otherwise break an attribute', () => {
    const out = renderEmailTemplate('<a title="{{name}}">x</a>', {
      name: 'He said "hi"',
    });
    expect(out).toBe('<a title="He said &quot;hi&quot;">x</a>');
  });

  it('does NOT escape when rendering the plain-text part', () => {
    // "&amp;" in a plain text email is simply wrong.
    const out = renderEmailTemplate('Hi {{name}}', { name: 'Raj & Sons' }, false);
    expect(out).toBe('Hi Raj & Sons');
  });

  it('leaves an unknown placeholder intact rather than printing undefined', () => {
    // Visible and obviously wrong beats a silent "undefined" in an inbox.
    const out = renderEmailTemplate('Hi {{name}}, id {{missing}}', {
      name: 'Aarav',
    });
    expect(out).toBe('Hi Aarav, id {{missing}}');
  });

  it('substitutes numbers as well as strings', () => {
    const out = renderEmailTemplate('{{days}} days', { days: 7 }, false);
    expect(out).toBe('7 days');
  });
});

describe('MockEmailProvider', () => {
  it('records each message and reports success', async () => {
    const provider = new MockEmailProvider({ writePreviews: false });

    const result = await provider.send({
      to: 'member@example.com',
      subject: 'Welcome',
      html: '<p>Hi</p>',
      text: 'Hi',
      templateKey: EmailTemplateKey.WELCOME,
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toMatch(/^mock_/);
    expect(provider.getOutbox()).toHaveLength(1);
    expect(provider.getOutbox()[0]!.to).toBe('member@example.com');
  });

  it('records attachment filenames', async () => {
    const provider = new MockEmailProvider({ writePreviews: false });

    await provider.send({
      to: 'member@example.com',
      subject: 'Welcome',
      html: '<p>Hi</p>',
      text: 'Hi',
      templateKey: EmailTemplateKey.WELCOME,
      attachments: [
        {
          filename: 'receipt-001.pdf',
          content: Buffer.from('%PDF-1.4'),
          contentType: 'application/pdf',
        },
      ],
    });

    expect(provider.getOutbox()[0]!.attachments).toEqual(['receipt-001.pdf']);
  });

  it('verifies as configured', async () => {
    const provider = new MockEmailProvider({ writePreviews: false });
    const result = await provider.verifyConfiguration();
    expect(result.ok).toBe(true);
  });
});
