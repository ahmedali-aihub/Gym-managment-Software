import { buildQrPayload } from '@azf/shared';
import QRCode from 'qrcode';

/**
 * Check-in QR codes.
 *
 * The encoded payload is `AZF:MEMBER:<memberId>:<qrToken>` — the printed
 * member ID plus a secret token held on the member record.
 *
 * Including the secret matters: a QR encoding only "AZF-2026-0042" could be
 * forged by anyone who has seen one member's card and can count. The token
 * makes a pass unguessable, and rotating it invalidates a screenshotted or
 * shared pass without reissuing the member's printed ID.
 */

/** Data URL for on-screen display and the member PWA pass. */
export async function generateQrDataUrl(
  memberId: string,
  qrToken: string,
): Promise<string> {
  return QRCode.toDataURL(buildQrPayload(memberId, qrToken), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

/** PNG buffer, for embedding in a printed ID card. */
export async function generateQrBuffer(
  memberId: string,
  qrToken: string,
): Promise<Buffer> {
  return QRCode.toBuffer(buildQrPayload(memberId, qrToken), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    type: 'png',
  });
}

/**
 * SVG, for crisp printing at any size.
 *
 * Level Q error correction here rather than M: a printed card lives in a gym
 * bag and will get scuffed, and the extra redundancy costs only a slightly
 * denser code.
 */
export async function generateQrSvg(
  memberId: string,
  qrToken: string,
): Promise<string> {
  return QRCode.toString(buildQrPayload(memberId, qrToken), {
    type: 'svg',
    errorCorrectionLevel: 'Q',
    margin: 1,
    width: 240,
  });
}
