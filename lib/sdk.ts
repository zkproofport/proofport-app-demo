import { ProofportSDK, type ProofResponse } from '@zkproofport-app/sdk';
import { VERIFIER_ABI } from '@zkproofport-app/core';
import { Wallet } from 'ethers';
import { verifierAddress } from './verifier-deployments';

export function createSDK(): ProofportSDK {
  let sdk: ProofportSDK;

  if (process.env.NEXT_PUBLIC_RELAY_URL) {
    sdk = new ProofportSDK({ relayUrl: process.env.NEXT_PUBLIC_RELAY_URL });
  } else if (typeof window !== 'undefined') {
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
  sdk.setSigner(Wallet.createRandom());
  return sdk;
}

/**
 * An SDK that verifies `proof` on-chain against core's pinned verifier for its
 * circuit, on the chain the proof names, provided the demo accepts that pair
 * (lib/verifier-deployments.ts). Throws, naming the key, for a proof with no
 * chain, an unknown circuit or a chain the demo does not accept.
 *
 * Why not `createSDK()`: since SDK 0.5.0-beta.2 the SDK never uses the
 * verifierAddress a response carries. An SDK built from a relay URL alone --
 * which is every deployed demo, because deploy.yml and docker-compose always
 * set NEXT_PUBLIC_RELAY_URL -- has no verifier and answers "No verifier
 * chosen" for every on-chain check. The verifier is configured here instead,
 * and the SDK still refuses a response whose verifierAddress differs from it.
 */
export function createVerifierSDK(proof: ProofResponse): ProofportSDK {
  const { circuit, chainId } = proof;
  if (chainId === undefined) throw new Error(`The ${circuit} proof names no chain, so there is no verifier to check it against.`);
  const address = verifierAddress(circuit, chainId);
  return new ProofportSDK({ verifiers: { [circuit]: { address, chainId, abi: VERIFIER_ABI } } });
}

export { ProofportSDK };
