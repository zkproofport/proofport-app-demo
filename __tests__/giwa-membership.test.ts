import { describe, expect, it } from 'vitest';
import { CIRCUIT_IDS, type RelayProofResult } from '@zkproofport-app/sdk';
import { keccak256, toUtf8Bytes } from 'ethers';
import { GIWA_CHAIN_ID, GIWA_SIGNER_ROOT, GIWA_VERIFIER, prepareGiwaMembershipProof } from '../lib/giwa-membership';

const requestId = 'current-request';
const scope = 'madang:giwa:membership:unique-attempt';
const fields = (hex: string) => hex.slice(2).match(/../g)!.map(byte => `0x${byte.padStart(64, '0')}`);

// This fixture exercises the consuming dApp's policy. It is not a valid
// cryptographic proof: the SDK/contract must still verify the returned object.
function result(): RelayProofResult {
  return {
    requestId, status: 'completed', circuit: CIRCUIT_IDS.GIWA_ATTESTATION,
    chainId: GIWA_CHAIN_ID, verifierAddress: GIWA_VERIFIER, proof: '0x1234',
    publicInputs: [
      ...fields('0x' + '00'.repeat(32)), ...fields(GIWA_SIGNER_ROOT),
      ...fields(keccak256(toUtf8Bytes(scope))), ...fields('0x' + '11'.repeat(32)),
    ],
  };
}

describe('GIWA membership proof policy', () => {
  it('prepares a response for the fixed GIWA verifier after policy checks', () => {
    const proof = prepareGiwaMembershipProof(result(), requestId, scope);
    expect(proof).toMatchObject({ circuit: CIRCUIT_IDS.GIWA_ATTESTATION, chainId: GIWA_CHAIN_ID, verifierAddress: GIWA_VERIFIER });
  });

  it.each([
    { requestId: 'old-request' }, { status: 'pending' }, { status: 'failed' },
    { circuit: CIRCUIT_IDS.COINBASE_ATTESTATION }, { chainId: 8453 },
    { verifierAddress: '0x' + '12'.repeat(20) }, { proof: '' }, { proof: '0xxyz' },
    { publicInputs: [] },
  ])('rejects an unrelated, incomplete or malformed response: %j', patch => {
    expect(() => prepareGiwaMembershipProof({ ...result(), ...patch } as RelayProofResult, requestId, scope)).toThrow();
  });

  it('rejects a proof generated for a previous attempt even if its request ID was replaced', () => {
    expect(() => prepareGiwaMembershipProof(result(), requestId, 'madang:giwa:membership:another-attempt')).toThrow('different membership request');
  });

  it('rejects an untrusted attester root', () => {
    const response = result();
    response.publicInputs![32] = '0x00';
    expect(() => prepareGiwaMembershipProof(response, requestId, scope)).toThrow('test issuer');
  });

  it('rejects field elements outside the byte range, including in the signal', () => {
    const response = result();
    response.publicInputs![0] = '0x100';
    expect(() => prepareGiwaMembershipProof(response, requestId, scope)).toThrow('Invalid GIWA public input');
  });
});
