import { api } from './api-client';

/**
 * Fetch a PDF through the authenticated client and open it in a new tab.
 *
 * WHY NOT `window.open(url)`. The access token is held in a module variable,
 * never in localStorage or a cookie — that is deliberate, and it means an
 * XSS cannot read it. But a new browser tab is a fresh document: it carries
 * no Authorization header, so every PDF route answered 401 and the tab
 * showed raw JSON instead of a receipt.
 *
 * Fetching as a blob through axios attaches the token like any other
 * request, and the resulting object URL opens with no auth needed because
 * the bytes are already local.
 *
 * The object URL is revoked on a timer rather than immediately: revoking
 * before the new tab has read it produces a blank viewer, and there is no
 * event that reliably fires when it has.
 */
export async function openPdf(path: string): Promise<void> {
  const response = await api.get<Blob>(path, { responseType: 'blob' });

  // An API error still arrives as a blob when responseType is set, so a
  // JSON body here means the request failed and the caller must be told.
  if (response.data.type.includes('json')) {
    const text = await response.data.text();
    throw new Error(
      (JSON.parse(text) as { error?: { message?: string } })?.error?.message ??
        'Could not generate the PDF',
    );
  }

  const url = URL.createObjectURL(
    new Blob([response.data], { type: 'application/pdf' }),
  );

  const opened = window.open(url, '_blank', 'noopener');

  // A blocked pop-up leaves the user with nothing and no explanation, so
  // fall back to a download, which browsers allow from a click handler.
  if (!opened) {
    const link = document.createElement('a');
    link.href = url;
    link.download = path.split('/').pop() ?? 'document.pdf';
    link.click();
  }

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
