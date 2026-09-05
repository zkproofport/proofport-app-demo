import { CIRCUIT_IDS, type ProofResponse, type RelayProofResult } from '@zkproofport-app/sdk';
import { keccak256, toUtf8Bytes } from 'ethers';

// CIP-4 PoC profile. Keep these aligned with the mobile app's giwaKyc.ts
// and circuits/giwa-attestation. The response never chooses our trust anchor.
export const GIWA_CHAIN_ID = 91342;
export const GIWA_VERIFIER = '0xeb9eb5452790cfe549ff83ceb3dbe1c432231492';
export const GIWA_SIGNER_ROOT = keccak256('0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b');
export const GIWA_EXPLORER = `https://sepolia-explorer.giwa.io/address/${GIWA_VERIFIER}`;

function readBytes(inputs: string[], start: number): string {
  return '0x' + inputs.slice(start, start + 32).map(value => {
    if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error('Malformed public input. Please create a new proof.');
    const byte = BigInt(value);
    if (byte > BigInt(255)) throw new Error('Invalid GIWA public input. Please create a new proof.');
    return byte.toString(16).padStart(2, '0');
  }).join('');
}

/** Validate the application policy before asking the pinned verifier to check the proof. */
export function prepareGiwaMembershipProof(result: RelayProofResult, requestId: string, scope: string): ProofResponse {
  if (result.requestId !== requestId) throw new Error('This proof belongs to a different request. Please try again.');
  if (result.status !== 'completed' || !result.proof || !/^0x(?:[0-9a-f]{2})+$/i.test(result.proof)) {
    throw new Error(result.error || 'No completed proof was received. Please try again.');
  }
  if (result.circuit !== CIRCUIT_IDS.GIWA_ATTESTATION) throw new Error('A GIWA account proof is required.');
  if (result.chainId !== GIWA_CHAIN_ID || result.verifierAddress?.toLowerCase() !== GIWA_VERIFIER) {
    throw new Error('This proof does not use the GIWA Sepolia demo verifier.');
  }
  if (result.publicInputs?.length !== 128) throw new Error('The GIWA proof has an unexpected public-input format.');
  const fields = [0, 32, 64, 96].map(offset => readBytes(result.publicInputs!, offset));
  if (fields[1] !== GIWA_SIGNER_ROOT) throw new Error('The attestation is not from the configured GIWA test issuer.');
  if (fields[2] !== keccak256(toUtf8Bytes(scope))) throw new Error('This proof was created for a different membership request.');
  return { requestId, circuit: CIRCUIT_IDS.GIWA_ATTESTATION, status: 'completed', proof: result.proof, publicInputs: result.publicInputs, chainId: GIWA_CHAIN_ID, verifierAddress: GIWA_VERIFIER };
}
