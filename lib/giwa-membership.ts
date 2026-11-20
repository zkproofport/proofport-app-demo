import { CIRCUIT_IDS, validateTypedAction, type TypedAction, type ProofResponse, type RelayProofResult } from '@zkproofport-app/sdk';
import { TypedDataEncoder, ZeroHash } from 'ethers';
import { GIWA_ATTESTATION_PUBLIC_INPUT_COUNT, GIWA_ATTESTATION_PUBLIC_INPUT_LAYOUT as GIWA, GIWA_SIGNER_SET } from '@zkproofport-app/core';
import { checkDemoOprfProof } from './oprf';
import { verifierAddress } from './verifier-deployments';

// CIP-4 PoC profile. Keep these aligned with the mobile app's giwaKyc.ts
// and circuits/giwa-attestation. The response never chooses our trust anchor.
export const GIWA_CHAIN_ID = 91342;
export const GIWA_VERIFIER = verifierAddress(CIRCUIT_IDS.GIWA_ATTESTATION, GIWA_CHAIN_ID);
/** 128 byte-valued inputs (signal, EIP-712 domain, action, issuer root), then the four OPRF fields. Core's count. */
export const GIWA_PUBLIC_INPUT_COUNT = GIWA_ATTESTATION_PUBLIC_INPUT_COUNT;
/** The GIWA attester's signer-list root, from core (the set the SDK's verify functions check). */
export const GIWA_SIGNER_ROOT = GIWA_SIGNER_SET.root;
export const GIWA_EXPLORER = `https://sepolia-explorer.giwa.io/address/${GIWA_VERIFIER}`;

function readBytes(inputs: string[], start: number): string {
  return '0x' + Array.from({ length: 32 }, (_, index) => {
    const value = inputs[start + index];
    if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('Malformed public input. Please create a new proof.');
    const byte = BigInt(value);
    if (byte > BigInt(255)) throw new Error('Invalid GIWA public input. Please create a new proof.');
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

/**
 * Validate the application policy before asking the pinned verifier to check the proof.
 * `oprfDomain` is the domain the request named; the proof's domain, scope and
 * OPRF key hash are core's to compare (lib/oprf.ts).
 */
export function prepareGiwaMembershipProof(
  result: RelayProofResult, requestId: string, scope: string, oprfDomain: string, expectedAction?: TypedAction,
): ProofResponse {
  if (result.requestId !== requestId) throw new Error('This proof belongs to a different request. Please try again.');
  if (result.status !== 'completed' || !result.proof || !/^0x(?:[0-9a-f]{2})+$/i.test(result.proof)) {
    throw new Error(result.error || 'No completed proof was received. Please try again.');
  }
  if (result.circuit !== CIRCUIT_IDS.GIWA_ATTESTATION) throw new Error('A GIWA account proof is required.');
  if (result.chainId !== GIWA_CHAIN_ID || result.verifierAddress?.toLowerCase() !== GIWA_VERIFIER) {
    throw new Error('This proof does not use the GIWA Sepolia demo verifier.');
  }
  if (!Array.isArray(result.publicInputs) || result.publicInputs.length !== GIWA_PUBLIC_INPUT_COUNT) throw new Error('The GIWA proof has an unexpected public-input format.');
  const [signal, domain, action, root] = [GIWA.SIGNAL_HASH_START, GIWA.DOMAIN_SEPARATOR_START, GIWA.ACTION_HASH_START, GIWA.MERKLE_ROOT_START]
    .map(offset => readBytes(result.publicInputs!, offset));
  if (root !== GIWA_SIGNER_ROOT) throw new Error('The attestation is not from the configured GIWA test issuer.');
  try {
    checkDemoOprfProof(CIRCUIT_IDS.GIWA_ATTESTATION, GIWA_CHAIN_ID, result.publicInputs, { scope, oprfDomain });
  } catch (cause) {
    throw new Error(`This proof does not match this membership request: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (expectedAction) {
    const problem = validateTypedAction(expectedAction);
    if (problem) throw new Error(`Invalid deposit action: ${problem}`);
    if (signal !== ZeroHash) throw new Error('An action proof must have a zero signal.');
    if (domain !== TypedDataEncoder.hashDomain(expectedAction.domain)) throw new Error('This proof authorizes a different action domain.');
    if (action !== TypedDataEncoder.hashStruct(expectedAction.primaryType, expectedAction.types, expectedAction.message)) throw new Error('This proof authorizes a different deposit action.');
  } else if (domain !== ZeroHash || action !== ZeroHash) {
    throw new Error('An identity proof cannot contain an unrequested action.');
  }
  return { requestId, circuit: CIRCUIT_IDS.GIWA_ATTESTATION, status: 'completed', proof: result.proof, publicInputs: result.publicInputs, chainId: GIWA_CHAIN_ID, verifierAddress: GIWA_VERIFIER };
}
