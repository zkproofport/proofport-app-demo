import { describe, expect, it } from 'vitest';
import { CIRCUIT_IDS, type RelayProofResult } from '@zkproofport-app/sdk';
import { prepareGiwaMembershipProof } from '../lib/giwa-membership';
import { depositAction, giwaResult, GIWA_TEST_VERIFIER, giwaFields, ZERO_WORD } from './fixtures/giwa';

const requestId = 'current-request';
const scope = 'madang:giwa:membership:unique-attempt';

describe('GIWA membership proof policy', () => {
  it('prepares a 192-byte identity proof for the pinned GIWA action verifier', () => {
    const proof = prepareGiwaMembershipProof(giwaResult(scope), requestId, scope);
    expect(proof).toMatchObject({ circuit: CIRCUIT_IDS.GIWA_ATTESTATION, chainId: 91342, verifierAddress: GIWA_TEST_VERIFIER });
    expect(proof.publicInputs).toHaveLength(192);
  });

  it('accepts the pinned verifier regardless of address casing', () => {
    const result = giwaResult(scope);
    result.verifierAddress = '0x5Da234546874304F8c51BBEed00fC632938211c1';
    expect(prepareGiwaMembershipProof(result, requestId, scope).verifierAddress).toBe(GIWA_TEST_VERIFIER);
  });

  it.each([
    { requestId: 'old-request' }, { status: 'pending' }, { status: 'failed' },
    { circuit: CIRCUIT_IDS.COINBASE_ATTESTATION }, { chainId: 8453 }, { chainId: undefined },
    { verifierAddress: '0x' + '12'.repeat(20) }, { verifierAddress: undefined },
    { verifierAddress: '0xeb9eb5452790cfe549ff83ceb3dbe1c432231492' },
    { proof: '' }, { proof: '0xxyz' }, { proof: '0x1' }, { proof: '0x' },
    { publicInputs: null }, { publicInputs: undefined }, { publicInputs: [] },
  ])('rejects an unrelated, incomplete or malformed response: %j', patch => {
    expect(() => prepareGiwaMembershipProof({ ...giwaResult(scope), ...patch } as RelayProofResult, requestId, scope)).toThrow();
  });

  it.each([128, 191, 193])('rejects an obsolete or wrong public-input count: %s', count => {
    const response = giwaResult(scope);
    response.publicInputs = Array.from({ length: count }, (_, index) => response.publicInputs![index] ?? '0x00');
    expect(() => prepareGiwaMembershipProof(response, requestId, scope)).toThrow(/public.input/i);
  });

  it('rejects a proof generated for a previous attempt even if its request ID was replaced', () => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope), requestId, 'madang:giwa:membership:another-attempt')).toThrow(/different.*request/i);
  });

  it('rejects an untrusted attester root at the new byte 96 offset', () => {
    const response = giwaResult(scope);
    response.publicInputs![96] = '0x00';
    expect(() => prepareGiwaMembershipProof(response, requestId, scope)).toThrow(/issuer|attester/i);
  });

  it.each(['곶간:예치:👛:한글/English', 'scope\nwith\ttabs', "scope:%_\\' OR 1=1;<script>"])('hashes the exact UTF-8 scope without normalization: %s', requestedScope => {
    const response = giwaResult(requestedScope);
    expect(prepareGiwaMembershipProof(response, requestId, requestedScope).publicInputs).toEqual(response.publicInputs);
    expect(() => prepareGiwaMembershipProof(response, requestId, requestedScope + ' ')).toThrow();
  });

  it('preserves an identity-only signal when no deposit action was requested', () => {
    const response = giwaResult(scope);
    response.publicInputs![0] = '0xff';
    expect(prepareGiwaMembershipProof(response, requestId, scope).publicInputs![0]).toBe('0xff');
  });

  it.each([32, 64])('rejects a nonzero domain/action byte at %s for identity-only membership', offset => {
    const response = giwaResult(scope);
    response.publicInputs![offset] = '0x01';
    expect(() => prepareGiwaMembershipProof(response, requestId, scope)).toThrow();
  });

  for (const [name, offset] of [['signal', 0], ['domain', 32], ['action', 64], ['root', 96], ['scope', 128], ['nullifier', 191]] as const) {
    it.each(['', ' ', '0x', '0xgg', 'xyz', '-1', '0x-1', '0x100', '0x200', '0x' + 'f'.repeat(65), null, undefined])(`rejects a malformed or out-of-byte-range ${name} field: %s`, value => {
      const response = giwaResult(scope);
      response.publicInputs![offset] = value as string;
      expect(() => prepareGiwaMembershipProof(response, requestId, scope)).toThrow(/input|byte/i);
    });
  }

  it('rejects a missing nullifier field hidden in a sparse 192-element array', () => {
    const response = giwaResult(scope);
    delete response.publicInputs![191];
    expect(() => prepareGiwaMembershipProof(response, requestId, scope)).toThrow(/input|byte/i);
  });
});

describe('GIWA proof binds the Gotgan EIP-712 deposit', () => {
  it('accepts the exact domain and Deposit hash requested by the vault', () => {
    const action = depositAction();
    const result = giwaResult(scope, action);
    expect(prepareGiwaMembershipProof(result, requestId, scope, action).publicInputs).toEqual(result.publicInputs);
  });

  it.each([
    ['account', '0x3333333333333333333333333333333333333333'],
    ['asset', '0x4444444444444444444444444444444444444444'],
    ['amount', '1000001'], ['nonce', '1'],
  ])('rejects a proof for a changed deposit %s', (field, value) => {
    const expected = depositAction();
    const altered = depositAction();
    altered.message[field] = value;
    expect(() => prepareGiwaMembershipProof(giwaResult(scope, altered), requestId, scope, expected)).toThrow(/action/i);
  });

  it.each([
    { name: 'Other vault' }, { version: '1' }, { chainId: 84532 },
    { verifyingContract: '0x3333333333333333333333333333333333333333' },
  ])('rejects a proof from a different EIP-712 domain: %j', patch => {
    const expected = depositAction();
    const altered = depositAction();
    altered.domain = { ...altered.domain, ...patch };
    expect(() => prepareGiwaMembershipProof(giwaResult(scope, altered), requestId, scope, expected)).toThrow(/domain/i);
  });

  it('rejects an identity-only proof when a deposit action was requested', () => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope), requestId, scope, depositAction())).toThrow();
  });

  it('rejects a deposit proof when an identity-only proof was requested', () => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope, depositAction()), requestId, scope)).toThrow();
  });

  it('rejects a nonzero signal even when domain and action match', () => {
    const action = depositAction();
    const result = giwaResult(scope, action);
    result.publicInputs![31] = '0x01';
    expect(() => prepareGiwaMembershipProof(result, requestId, scope, action)).toThrow(/signal/i);
  });

  it('rejects an independently cleared action hash', () => {
    const action = depositAction();
    const result = giwaResult(scope, action);
    result.publicInputs!.splice(64, 32, ...giwaFields(ZERO_WORD));
    expect(() => prepareGiwaMembershipProof(result, requestId, scope, action)).toThrow(/action/i);
  });
});
