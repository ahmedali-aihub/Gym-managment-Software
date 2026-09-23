import { env, isTest } from '../../../config/env.js';
import { moduleLogger } from '../../../lib/logger.js';
import { Fast2SmsProvider } from './fast2sms.provider.js';
import { MockSmsProvider } from './mock.provider.js';
import { Msg91Provider } from './msg91.provider.js';
import type { SmsProviderAdapter } from './provider.interface.js';
import { TwilioProvider } from './twilio.provider.js';

const log = moduleLogger('sms:factory');

export type { SmsProviderAdapter, SmsSendParams, SmsDeliveryStatus } from './provider.interface.js';
export { MockSmsProvider } from './mock.provider.js';
export { Msg91Provider } from './msg91.provider.js';
export { TwilioProvider } from './twilio.provider.js';
export { Fast2SmsProvider } from './fast2sms.provider.js';

let instance: SmsProviderAdapter | null = null;

/**
 * Build the provider named by SMS_PROVIDER.
 *
 * This factory is the only place in the codebase that knows which concrete
 * provider is in use — everything else depends on the interface. Switching
 * providers is an env change and a restart.
 */
function createProvider(): SmsProviderAdapter {
  switch (env.SMS_PROVIDER) {
    case 'msg91':
      return new Msg91Provider();
    case 'twilio':
      return new TwilioProvider();
    case 'fast2sms':
      return new Fast2SmsProvider();
    case 'mock':
    default:
      // In tests, a non-zero failure rate would make assertions flaky.
      return new MockSmsProvider({ failureRate: isTest ? 0 : 0 });
  }
}

export function getSmsProvider(): SmsProviderAdapter {
  instance ??= createProvider();
  return instance;
}

/** Test seam: swap in a stub provider. */
export function setSmsProvider(provider: SmsProviderAdapter | null): void {
  instance = provider;
}

/** Called at boot; logs a warning rather than blocking startup. */
export async function verifySmsProvider(): Promise<void> {
  const provider = getSmsProvider();
  const result = await provider.verifyConfiguration();

  if (result.ok) {
    log.info(`SMS provider: ${provider.name} — ${result.message}`);
  } else {
    log.warn(
      `SMS provider ${provider.name} is misconfigured: ${result.message}`,
    );
  }
}
