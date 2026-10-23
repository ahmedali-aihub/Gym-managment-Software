/**
 * Opening WhatsApp on a member's chat with a message already typed, so the
 * front desk only has to press Send.
 *
 * Which link works depends on the device:
 *  • phone — wa.me opens the WhatsApp app directly;
 *  • computer with WhatsApp Web — web.whatsapp.com/send goes straight into
 *    the chat (wa.me would stop on a "Continue to chat" page first);
 *  • computer with the WhatsApp desktop app — the whatsapp:// link.
 * The computer's choice is remembered per device.
 *
 * None of these can attach a file; the receipt travels as a link in the
 * text (see the API's lib/receipt-link).
 */

/** A message the API has built, ready to send. */
export interface WhatsAppMessage {
  /** 91XXXXXXXXXX */
  phone: string;
  text: string;
}

export type WhatsAppTarget = 'web' | 'app';

const TARGET_KEY = 'azf-whatsapp-target';

export function isPhoneDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export function getWhatsAppTarget(): WhatsAppTarget {
  try {
    return localStorage.getItem(TARGET_KEY) === 'app' ? 'app' : 'web';
  } catch {
    // Storage blocked (private window): WhatsApp Web works everywhere.
    return 'web';
  }
}

export function setWhatsAppTarget(target: WhatsAppTarget): void {
  try {
    localStorage.setItem(TARGET_KEY, target);
  } catch {
    // Not remembered, but this send still uses the choice.
  }
}

export function whatsAppLink(
  message: WhatsAppMessage,
  target: WhatsAppTarget = getWhatsAppTarget(),
): string {
  const text = encodeURIComponent(message.text);

  if (isPhoneDevice()) return `https://wa.me/${message.phone}?text=${text}`;

  return target === 'app'
    ? `whatsapp://send?phone=${message.phone}&text=${text}`
    : `https://web.whatsapp.com/send?phone=${message.phone}&text=${text}`;
}

/**
 * Open the member's chat. Returns false when the browser blocked the new
 * tab — it allows one only shortly after a click — so the caller can offer
 * a button to try again.
 */
export function openWhatsApp(message: WhatsAppMessage): boolean {
  const url = whatsAppLink(message);

  if (url.startsWith('whatsapp:')) {
    // Hands over to the desktop app; the page itself stays put.
    window.location.href = url;
    return true;
  }

  // One named tab, reused: WhatsApp Web allows a single open session, and a
  // fresh tab per member would keep tripping its "open in another window"
  // prompt.
  return window.open(url, 'azf-whatsapp') !== null;
}
