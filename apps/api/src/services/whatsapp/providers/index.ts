import { env } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import { MetaWhatsAppProvider } from './meta.provider.js';
import { MockWhatsAppProvider } from './mock.provider.js';
import type { WhatsAppProviderAdapter } from './provider.interface.js';

const log = moduleLogger('whatsapp:factory');

export type {
  WhatsAppProviderAdapter,
  WhatsAppSendParams,
  WhatsAppSendResult,
} from './provider.interface.js';
export { MockWhatsAppProvider } from './mock.provider.js';
export { MetaWhatsAppProvider } from './meta.provider.js';

let instance: WhatsAppProviderAdapter | null = null;

/**
 * Build the provider named by WHATSAPP_PROVIDER.
 *
 * The only place that knows which concrete provider is in use. Activating
 * Meta once business verification completes is an env change and a restart.
 */
function createProvider(): WhatsAppProviderAdapter {
  switch (env.WHATSAPP_PROVIDER) {
    case 'meta':
      return new MetaWhatsAppProvider();
    case 'mock':
    default:
      return new MockWhatsAppProvider();
  }
}

export function getWhatsAppProvider(): WhatsAppProviderAdapter {
  instance ??= createProvider();
  return instance;
}

/** Test seam: swap in a stub provider. */
export function setWhatsAppProvider(
  provider: WhatsAppProviderAdapter | null,
): void {
  instance = provider;
}

/** Called at boot; logs a warning rather than blocking startup. */
export async function verifyWhatsAppProvider(): Promise<void> {
  if (!env.WHATSAPP_ENABLED) {
    log.info('WhatsApp is disabled (WHATSAPP_ENABLED=false)');
    return;
  }

  const provider = getWhatsAppProvider();
  const result = await provider.verifyConfiguration();

  if (result.ok) {
    log.info(`WhatsApp provider: ${provider.name} — ${result.message}`);
  } else {
    log.warn(
      `WhatsApp provider ${provider.name} is misconfigured: ${result.message}`,
    );
  }
}
