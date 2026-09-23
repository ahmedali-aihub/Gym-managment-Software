/**
 * Redirect-target sanitisation.
 *
 * The login page remembers where the user was heading and returns them there
 * afterwards. That target comes from the URL, which makes it attacker-
 * controlled: a link like
 *
 *   https://gym.example.com/login?next=https://evil.example/login
 *
 * would bounce a receptionist to a copy of our login page immediately after
 * they authenticate, at a moment when they are primed to type a password.
 *
 * React Router 6 does not sanitise this (GHSA-wrjc-x8rr-h8h6 — a backslash
 * bypass of CVE-2025-68470, unpatched in the whole v6 line), so the check
 * lives here and every redirect in the app is required to go through it.
 *
 * The rule: only same-origin, absolute, single-slash paths are allowed.
 * Everything else falls back to the dashboard.
 */

const FALLBACK = '/dashboard';

export function safeRedirectPath(
  target: string | null | undefined,
  fallback: string = FALLBACK,
): string {
  if (!target) return fallback;

  // Reject anything that is not a plain path before parsing. Backslashes are
  // the specific bypass in this advisory: browsers normalise "/\evil.com" and
  // "\\evil.com" to a protocol-relative URL, so a naive startsWith('/') check
  // passes them straight through.
  if (target.includes('\\')) return fallback;

  // Control characters and whitespace can be used to smuggle a scheme past
  // string checks; a legitimate path never contains them.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(target)) return fallback;

  // Must be an absolute path, and must not be protocol-relative ("//host").
  if (!target.startsWith('/') || target.startsWith('//')) return fallback;

  // A scheme anywhere means it is not a bare path: "/redirect?to=javascript:…"
  // is fine as a path, but "javascript:…" as the target is not.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return fallback;

  // Final confirmation: resolve against a dummy origin and require that the
  // result did not escape it.
  try {
    const dummyOrigin = 'https://azf.invalid';
    const url = new URL(target, dummyOrigin);
    if (url.origin !== dummyOrigin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Read and sanitise the post-login destination from a query string. */
export function getRedirectTarget(
  search: string,
  paramName = 'next',
): string {
  const params = new URLSearchParams(search);
  return safeRedirectPath(params.get(paramName));
}
