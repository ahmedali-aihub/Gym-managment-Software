import { describe, expect, it } from 'vitest';
import { getRedirectTarget, safeRedirectPath } from './safe-redirect';

/**
 * Open-redirect guard tests.
 *
 * The attack payloads below are the ones that actually defeat naive
 * implementations — particularly the backslash variants, which are the
 * specific bypass in GHSA-wrjc-x8rr-h8h6 and which a `startsWith('/')`
 * check waves straight through.
 */

describe('safeRedirectPath — allows legitimate paths', () => {
  it.each([
    '/dashboard',
    '/members',
    '/members/abc123',
    '/members?status=ACTIVE',
    '/members?status=ACTIVE&page=2',
    '/payments#receipts',
    '/members/new?plan=quarterly&trainer=xyz',
  ])('allows %s', (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });
});

describe('safeRedirectPath — blocks external redirects', () => {
  it.each([
    // Absolute URLs
    'https://evil.example/login',
    'http://evil.example',
    'HTTPS://EVIL.EXAMPLE',
    // Protocol-relative: the browser resolves these to an external host
    '//evil.example',
    '//evil.example/login',
    // Backslash bypasses — the CVE-2025-68470 follow-up
    '/\\evil.example',
    '\\\\evil.example',
    '/\\/evil.example',
    '\\/evil.example',
    '/path\\..\\..\\evil',
    // Scheme-based payloads
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    // Whitespace / control-character smuggling
    ' //evil.example',
    '\t/\t/evil.example',
    '/\u0000//evil.example',
    '\n//evil.example',
    // Relative paths could resolve anywhere depending on current location
    'dashboard',
    '../admin',
    './settings',
  ])('blocks %j', (payload) => {
    expect(safeRedirectPath(payload)).toBe('/dashboard');
  });
});

describe('safeRedirectPath — empty and malformed input', () => {
  it.each([null, undefined, ''])('falls back for %j', (value) => {
    expect(safeRedirectPath(value)).toBe('/dashboard');
  });

  it('honours a custom fallback', () => {
    expect(safeRedirectPath('https://evil.example', '/login')).toBe('/login');
  });

  it('never returns a value that is not an absolute path', () => {
    const payloads = [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '',
      'relative',
    ];

    for (const payload of payloads) {
      const result = safeRedirectPath(payload);
      expect(result.startsWith('/')).toBe(true);
      expect(result.startsWith('//')).toBe(false);
      expect(result).not.toContain('\\');
    }
  });
});

describe('getRedirectTarget', () => {
  it('reads the next parameter from a query string', () => {
    expect(getRedirectTarget('?next=/members')).toBe('/members');
  });

  it('preserves query parameters within the target', () => {
    const search = `?next=${encodeURIComponent('/members?status=EXPIRED')}`;
    expect(getRedirectTarget(search)).toBe('/members?status=EXPIRED');
  });

  it('falls back when the parameter is absent', () => {
    expect(getRedirectTarget('?other=value')).toBe('/dashboard');
  });

  it('blocks an external target supplied in the query string', () => {
    const search = `?next=${encodeURIComponent('https://evil.example/login')}`;
    expect(getRedirectTarget(search)).toBe('/dashboard');
  });

  it('blocks a backslash payload supplied in the query string', () => {
    const search = `?next=${encodeURIComponent('/\\evil.example')}`;
    expect(getRedirectTarget(search)).toBe('/dashboard');
  });

  it('supports a custom parameter name', () => {
    expect(getRedirectTarget('?redirect=/payments', 'redirect')).toBe(
      '/payments',
    );
  });
});
