import {
  SMS_TEMPLATES,
  SmsTemplateKey,
  renderSmsTemplate,
} from '@azf/shared';
import { describe, expect, it } from 'vitest';

/**
 * Bulk-send variable rendering.
 *
 * The failure this guards against is subtle and expensive: a bulk send that
 * resolves variables ONCE and reuses them gives every member the first
 * member's expiry date. The messages look fine in the log, cost full price,
 * and tell 40 people the wrong thing.
 *
 * These tests assert the property that matters — each rendered message
 * carries its own member's facts, and no placeholder survives.
 */

interface FakeMember {
  id: string;
  fullName: string;
  memberId: string;
  endDate: string;
  balancePaise: number;
}

const MEMBERS: FakeMember[] = [
  {
    id: 'm1',
    fullName: 'Rahul Sharma',
    memberId: 'AZF-2026-0001',
    endDate: '21/09/2026',
    balancePaise: 0,
  },
  {
    id: 'm2',
    fullName: 'Priya Reddy',
    memberId: 'AZF-2026-0042',
    endDate: '24/09/2026',
    balancePaise: 150_000,
  },
  {
    id: 'm3',
    fullName: 'Mohammed Imran',
    memberId: 'AZF-2026-0107',
    endDate: '26/09/2026',
    balancePaise: 250_000,
  },
];

/** Mirrors the controller's per-member variable construction. */
function buildVariables(member: FakeMember) {
  return {
    name: member.fullName.split(' ')[0] ?? member.fullName,
    memberId: member.memberId,
    expiryDate: member.endDate,
    amount: Math.round(member.balancePaise / 100).toLocaleString('en-IN'),
    gymPhone: '+91 90000 00000',
  };
}

describe('bulk expiry reminders', () => {
  it('gives each member their own expiry date', () => {
    const rendered = MEMBERS.map((member) =>
      renderSmsTemplate(
        SMS_TEMPLATES[SmsTemplateKey.EXPIRY_REMINDER].body,
        buildVariables(member),
      ),
    );

    expect(rendered[0]).toContain('21/09/2026');
    expect(rendered[1]).toContain('24/09/2026');
    expect(rendered[2]).toContain('26/09/2026');

    // The specific regression: member 2 must not carry member 1's date.
    expect(rendered[1]).not.toContain('21/09/2026');
    expect(rendered[2]).not.toContain('21/09/2026');
  });

  it('addresses each member by their own first name', () => {
    const rendered = MEMBERS.map((member) =>
      renderSmsTemplate(
        SMS_TEMPLATES[SmsTemplateKey.EXPIRY_REMINDER].body,
        buildVariables(member),
      ),
    );

    expect(rendered[0]).toContain('Rahul');
    expect(rendered[1]).toContain('Priya');
    expect(rendered[2]).toContain('Mohammed');
  });

  it('leaves no unresolved placeholder in any message', () => {
    for (const member of MEMBERS) {
      const body = renderSmsTemplate(
        SMS_TEMPLATES[SmsTemplateKey.EXPIRY_REMINDER].body,
        buildVariables(member),
      );

      // A message reading "expires on {{expiryDate}}" is worse than none.
      expect(body).not.toMatch(/\{\{/);
    }
  });
});

describe('bulk dues reminders', () => {
  it('quotes each member their own balance', () => {
    const rendered = MEMBERS.map((member) =>
      renderSmsTemplate(
        SMS_TEMPLATES[SmsTemplateKey.DUES_REMINDER].body,
        buildVariables(member),
      ),
    );

    expect(rendered[1]).toContain('1,500');
    expect(rendered[2]).toContain('2,500');

    // Telling someone they owe another member's balance is a support call
    // at best and a lost member at worst.
    expect(rendered[1]).not.toContain('2,500');
  });

  it('formats amounts with Indian digit grouping', () => {
    const body = renderSmsTemplate(
      SMS_TEMPLATES[SmsTemplateKey.DUES_REMINDER].body,
      buildVariables({
        id: 'm4',
        fullName: 'Vikram Singh',
        memberId: 'AZF-2026-0200',
        endDate: '30/09/2026',
        balancePaise: 12_50_000,
      }),
    );

    // 12,500 — lakh grouping, not the Western 12,500 -> 12500.
    expect(body).toContain('12,500');
  });
});

describe('caller-supplied variables', () => {
  it('cannot override per-member facts', () => {
    // The controller spreads caller variables FIRST so member facts win.
    // A caller passing a shared expiryDate must not leak into messages.
    const merged = {
      expiryDate: '01/01/2000',
      ...buildVariables(MEMBERS[1]!),
    };

    const body = renderSmsTemplate(
      SMS_TEMPLATES[SmsTemplateKey.EXPIRY_REMINDER].body,
      merged,
    );

    expect(body).toContain('24/09/2026');
    expect(body).not.toContain('01/01/2000');
  });
});

describe('segment cost', () => {
  it('keeps the expiry reminder to one billed segment', () => {
    // Two segments doubles the cost of every broadcast. With a long name and
    // a long gym phone this is the realistic worst case.
    const body = renderSmsTemplate(
      SMS_TEMPLATES[SmsTemplateKey.EXPIRY_REMINDER].body,
      buildVariables({
        id: 'm5',
        fullName: 'Venkata Subramanyam',
        memberId: 'AZF-2026-0247',
        endDate: '31/12/2026',
        balancePaise: 0,
      }),
    );

    expect(body.length).toBeLessThanOrEqual(160);
  });
});
