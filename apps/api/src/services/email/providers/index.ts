import { env, isTest } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import { MockEmailProvider } from './mock.provider.js';
import type { EmailProviderAdapter } from './provider.interface.js';
import { SmtpEmailProvider } from './smtp.provider.js';

const log = moduleLogger('email:factory');

export type {
  EmailProviderAdapter,
  EmailSendParams,
  EmailSendResult,
  EmailAttachment,
} from './provider.interface.js';
export { MockEmailProvider } from './mock.provider.js';
export { SmtpEmailProvider } from './smtp.provider.js';

let instance: EmailProviderAdapter | null = null;

/**
 * Build the provider named by EMAIL_PROVIDER.
 *
 * The only place that knows which concrete provider is in use. Brevo and
 * Resend are accepted by the env schema but not yet implemented — they fall
 * through to the mock with a warning rather than crashing at boot, so a
 * premature env change degrades instead of taking the server down.
 */
function createProvider(): EmailProviderAdapter {
  switch (env.EMAIL_PROVIDER) {
    case 'smtp':
      return new SmtpEmailProvider();

    case 'brevo':
    case 'resend':
      log.warn(
        `EMAIL_PROVIDER=${env.EMAIL_PROVIDER} is not implemented yet; falling back to mock`,
      );
      return new MockEmailProvider({ writePreviews: !isTest });

    case 'mock':
    default:
      return new MockEmailProvider({ writePreviews: !isTest });
  }
}

export function getEmailProvider(): EmailProviderAdapter {
  instance ??= createProvider();
  return instance;
}

/** Test seam: swap in a stub provider. */
export function setEmailProvider(provider: EmailProviderAdapter | null): void {
  instance = provider;
}

/** Called at boot; logs a warning rather than blocking startup. */
export async function verifyEmailProvider(): Promise<void> {
  if (!env.EMAIL_ENABLED) {
    log.info('Email is disabled (EMAIL_ENABLED=false)');
    return;
  }

  const provider = getEmailProvider();
  const result = await provider.verifyConfiguration();

  if (result.ok) {
    log.info(`Email provider: ${provider.name} — ${result.message}`);
  } else {
    log.warn(
      `Email provider ${provider.name} is misconfigured: ${result.message}`,
    );
  }
}
