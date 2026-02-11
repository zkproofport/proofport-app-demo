import { ProofportSDK } from '@zkproofport-app/sdk';
import type { SDKEnvironment } from '@zkproofport-app/sdk';

export function detectSDKEnv(): SDKEnvironment {
  if (typeof window === 'undefined') return 'local';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return 'local';
  if (host.startsWith('stg-') || host.includes('staging')) return 'staging';
  return 'production';
}

export function createSDK(): ProofportSDK {
  const env = detectSDKEnv();
  if (env === 'local') {
    const localRelayUrl = `${window.location.protocol}//${window.location.hostname}:4001`;
    return new ProofportSDK({ relayUrl: localRelayUrl });
  }
  return ProofportSDK.create(env);
}

export { ProofportSDK };
