import { CIRCUIT_IDS, validateTypedAction, type TypedAction, type ProofResponse, type RelayProofResult } from '@zkproofport-app/sdk';
import { keccak256, toUtf8Bytes, TypedDataEncoder, ZeroHash } from 'ethers';

// CIP-4 PoC profile. Keep these aligned with the mobile app's giwaKyc.ts
// and circuits/giwa-attestation. The response never chooses our trust anchor.
export const GIWA_CHAIN_ID = 91342;
export const GIWA_VERIFIER = '0x5da234546874304f8c51bbeed00fc632938211c1';
export const GIWA_PUBLIC_INPUT_COUNT = 192;
export const GIWA_SIGNER_ROOT = keccak256('0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b');
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

/** Validate the application policy before asking the pinned verifier to check the proof. */
export function prepareGiwaMembershipProof(result: RelayProofResult, requestId: string, scope: string, expectedAction?: TypedAction): ProofResponse {
  if (result.requestId !== requestId) throw new Error('This proof belongs to a different request. Please try again.');
  if (result.status !== 'completed' || !result.proof || !/^0x(?:[0-9a-f]{2})+$/i.test(result.proof)) {
    throw new Error(result.error || 'No completed proof was received. Please try again.');
  }
  if (result.circuit !== CIRCUIT_IDS.GIWA_ATTESTATION) throw new Error('A GIWA account proof is required.');
  if (result.chainId !== GIWA_CHAIN_ID || result.verifierAddress?.toLowerCase() !== GIWA_VERIFIER) {
    throw new Error('This proof does not use the GIWA Sepolia demo verifier.');
  }
  if (!Array.isArray(result.publicInputs) || result.publicInputs.length !== GIWA_PUBLIC_INPUT_COUNT) throw new Error('The GIWA proof has an unexpected public-input format.');
  const [signal, domain, action, root, scopeHash] = [0, 32, 64, 96, 128, 160].map(offset => readBytes(result.publicInputs!, offset));
  if (root !== GIWA_SIGNER_ROOT) throw new Error('The attestation is not from the configured GIWA test issuer.');
  if (scopeHash !== keccak256(toUtf8Bytes(scope))) throw new Error('This proof was created for a different membership request.');
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
