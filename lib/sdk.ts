import { ProofportSDK } from '@zkproofport-app/sdk';
import { ethers } from 'ethers';

export function createSDK(): ProofportSDK {
  let sdk: ProofportSDK;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
      const localRelayUrl = `${window.location.protocol}//${window.location.hostname}:4001`;
      sdk = new ProofportSDK({ relayUrl: localRelayUrl });
    } else if (host.startsWith('stg-')) {
      sdk = ProofportSDK.create('staging');
    } else {
      sdk = ProofportSDK.create();
    }
  } else {
    sdk = ProofportSDK.create();
  }

  // Ephemeral random wallet — only used for relay nonce replay prevention
  sdk.setSigner(ethers.Wallet.createRandom());
  return sdk;
}

export { ProofportSDK };
