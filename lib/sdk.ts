import { ProofportSDK, type ProofResponse, type SDKEnvironment } from '@zkproofport-app/sdk';
import { VERIFIER_ABI } from '@zkproofport-app/core';
import { Wallet } from 'ethers';
import { proofSignerVariant, variantVerifierAddress, verifierAddress } from './verifier-deployments';

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
 * circuit, its package and the chain it names, provided the demo accepts that
 * pair (lib/verifier-deployments.ts). Throws, naming the key, for a proof with
 * no chain, an unknown circuit, a chain the demo does not accept, or a package
 * claim the proof contradicts.
 *
 * Why not `createSDK()`: since SDK 0.5.0-beta.2 the SDK never uses the
 * verifierAddress a response carries. An SDK built from a relay URL alone --
 * which is every deployed demo, because deploy.yml and docker-compose always
 * set NEXT_PUBLIC_RELAY_URL -- has no verifier and answers "No verifier
 * chosen" for every on-chain check. The verifier is configured here instead,
 * and the SDK still refuses a response whose verifierAddress differs from it.
 *
 * A configured verifier is the standard package's contract only. A proof from
 * an Android signer's package is verified on its environment's chains instead,
 * where the SDK picks that package's pinned verifier; the chain decides which
 * environment, and an unlisted chain is an error.
 */
const VARIANT_ENVIRONMENTS: Readonly<Record<number, SDKEnvironment>> = Object.freeze({ 8453: 'production', 84532: 'staging' });

export function createVerifierSDK(proof: ProofResponse): ProofportSDK {
  const { circuit, chainId } = proof;
  if (chainId === undefined) throw new Error(`The ${circuit} proof names no chain, so there is no verifier to check it against.`);
  const address = verifierAddress(circuit, chainId);
  const variant = proofSignerVariant(circuit, proof.signerVariant, proof.proof);
  if (variant === 'standard') return new ProofportSDK({ verifiers: { [circuit]: { address, chainId, abi: VERIFIER_ABI } } });
  variantVerifierAddress(circuit, chainId, variant);
  const environment = Object.hasOwn(VARIANT_ENVIRONMENTS, chainId) ? VARIANT_ENVIRONMENTS[chainId] : undefined;
  if (!environment) throw new Error(`No environment verifies chain ${chainId}. Known: ${Object.keys(VARIANT_ENVIRONMENTS).join(', ')}.`);
  return new ProofportSDK({ environment });
}

export { ProofportSDK };
