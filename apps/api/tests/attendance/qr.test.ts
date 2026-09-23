import { buildQrPayload, parseQrPayload } from '@azf/shared';
import { describe, expect, it } from 'vitest';

/**
 * QR pass parsing.
 *
 * The payload is `AZF:MEMBER:<memberId>:<token>`. Both halves are verified at
 * check-in: the printed member ID alone is guessable by anyone who has seen
 * one card, so the secret token is what makes a pass unforgeable.
 *
 * These tests cover what a real scanner actually emits — including the
 * malformed input that arrives when someone scans a supermarket barcode.
 */

describe('buildQrPayload', () => {
  it('produces the namespaced format', () => {
    expect(buildQrPayload('AZF-2026-0042', 'tok_abc123')).toBe(
      'AZF:MEMBER:AZF-2026-0042:tok_abc123',
    );
  });

  it('round-trips through parse', () => {
    const payload = buildQrPayload('AZF-2026-0001', 'secret-token');
    expect(parseQrPayload(payload)).toEqual({
      memberId: 'AZF-2026-0001',
      token: 'secret-token',
    });
  });
});

describe('parseQrPayload — valid input', () => {
  it('splits on the LAST colon, so hyphenated IDs survive', () => {
    // The member ID itself contains hyphens but no colons; splitting on the
    // first colon would truncate it.
    const parsed = parseQrPayload('AZF:MEMBER:AZF-2026-0247:xyz789');

    expect(parsed?.memberId).toBe('AZF-2026-0247');
    expect(parsed?.token).toBe('xyz789');
  });

  it('handles a cuid token, which is what the schema generates', () => {
    const parsed = parseQrPayload(
      'AZF:MEMBER:AZF-2026-0100:clx3k2j9a0000qwer1234tyui',
    );

    expect(parsed?.token).toBe('clx3k2j9a0000qwer1234tyui');
  });
});

describe('parseQrPayload — rejects anything else', () => {
  it.each([
    // A different gym's pass, or a random QR from a product label.
    ['OTHER:MEMBER:AZF-2026-0001:token', 'wrong namespace'],
    ['AZF:TRAINER:AZF-2026-0001:token', 'wrong entity type'],
    // A plain member ID with no token — the forgery this design prevents.
    ['AZF-2026-0001', 'bare member ID'],
    ['AZF:MEMBER:', 'no ID or token'],
    ['AZF:MEMBER:AZF-2026-0001:', 'empty token'],
    ['AZF:MEMBER::token', 'empty member ID'],
    ['', 'empty string'],
    ['https://example.com', 'a URL from some other QR code'],
    ['8901234567890', 'a supermarket barcode'],
  ])('rejects %j (%s)', (payload) => {
    expect(parseQrPayload(payload)).toBeNull();
  });

  it('rejects a payload missing the token separator entirely', () => {
    expect(parseQrPayload('AZF:MEMBER:AZF-2026-0001')).toBeNull();
  });
});

describe('forgery resistance', () => {
  it('a guessed member ID is useless without the token', () => {
    // Someone who has seen one card can guess AZF-2026-0002 exists. Parsing
    // succeeds, but the lookup requires BOTH fields to match a row, so the
    // wrong token finds nothing.
    const guessed = parseQrPayload('AZF:MEMBER:AZF-2026-0002:guessed');

    expect(guessed).not.toBeNull();
    // The parse is intentionally permissive; rejection happens at the
    // database query, which is where the secret is actually checked.
    expect(guessed?.token).toBe('guessed');
  });

  it('two members never share a payload', () => {
    const a = buildQrPayload('AZF-2026-0001', 'token-a');
    const b = buildQrPayload('AZF-2026-0002', 'token-b');

    expect(a).not.toBe(b);
  });

  it('rotating a token invalidates the old pass', () => {
    const before = buildQrPayload('AZF-2026-0001', 'old-token');
    const after = buildQrPayload('AZF-2026-0001', 'new-token');

    // Same printed ID, different payload — which is the point: a shared
    // screenshot stops working without reissuing the member's card.
    expect(parseQrPayload(before)?.memberId).toBe(
      parseQrPayload(after)?.memberId,
    );
    expect(parseQrPayload(before)?.token).not.toBe(
      parseQrPayload(after)?.token,
    );
  });
});
