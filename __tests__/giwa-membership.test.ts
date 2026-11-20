import { describe, expect, it } from 'vitest';
import { CIRCUIT_IDS, type RelayProofResult } from '@zkproofport-app/sdk';
import { prepareGiwaMembershipProof } from '../lib/giwa-membership';
import { reduceOprfName } from '@zkproofport-app/core';
import {
  DEMO_DOMAIN, DEMO_DOMAIN_FIELD, depositAction, GIWA_OPRF, giwaResult, GIWA_TEST_VERIFIER, giwaFields, TESTNET_OPRF_KEY_HASH, ZERO_WORD,
} from './fixtures/giwa';

const requestId = 'current-request';
const scope = 'madang:giwa:membership:unique-attempt';
const domain = DEMO_DOMAIN;

describe('GIWA membership proof policy', () => {
  it('prepares a 132-input identity proof for the pinned GIWA action verifier', () => {
    const proof = prepareGiwaMembershipProof(giwaResult(scope), requestId, scope, domain);
    expect(proof).toMatchObject({ circuit: CIRCUIT_IDS.GIWA_ATTESTATION, chainId: 91342, verifierAddress: GIWA_TEST_VERIFIER });
    expect(proof.publicInputs).toHaveLength(132);
  });

  it('accepts the pinned verifier regardless of address casing', () => {
    const result = giwaResult(scope);
    result.verifierAddress = '0xA272056866453F0182426A29B9Ca6382d6C6a060';
    expect(prepareGiwaMembershipProof(result, requestId, scope, domain).verifierAddress).toBe(GIWA_TEST_VERIFIER);
  });

  it.each([
    { requestId: 'old-request' }, { status: 'pending' }, { status: 'failed' },
    { circuit: CIRCUIT_IDS.COINBASE_ATTESTATION }, { chainId: 8453 }, { chainId: undefined },
    { verifierAddress: '0x' + '12'.repeat(20) }, { verifierAddress: undefined },
    { verifierAddress: '0xeb9eb5452790cfe549ff83ceb3dbe1c432231492' },
    { verifierAddress: '0x5da234546874304f8c51bbeed00fc632938211c1' },
    // The beta.19 verifier: its key is not this circuit's any more.
    { verifierAddress: '0xf6edb9d6114b2546b6e559997fdde08caeea83b3' },
    { proof: '' }, { proof: '0xxyz' }, { proof: '0x1' }, { proof: '0x' },
    { publicInputs: null }, { publicInputs: undefined }, { publicInputs: [] },
  ])('rejects an unrelated, incomplete or malformed response: %j', patch => {
    expect(() => prepareGiwaMembershipProof({ ...giwaResult(scope), ...patch } as RelayProofResult, requestId, scope, domain)).toThrow();
  });

  it.each([128, 131, 133, 192])('rejects an obsolete or wrong public-input count: %s', count => {
    const response = giwaResult(scope);
    response.publicInputs = Array.from({ length: count }, (_, index) => response.publicInputs![index] ?? '0x00');
    expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/public.input/i);
  });

  it('rejects a proof generated for a previous attempt even if its request ID was replaced', () => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope), requestId, 'madang:giwa:membership:another-attempt', domain)).toThrow(/membership request.*scope/i);
  });

  it('rejects an untrusted attester root at the new byte 96 offset', () => {
    const response = giwaResult(scope);
    response.publicInputs![96] = '0x00';
    expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/issuer|attester/i);
  });

  it.each(['곶간:예치:👛:한글/English', 'scope with spaces', "scope:%_\\' OR 1=1;<script>", 'x'.repeat(256)])('hashes the exact UTF-8 scope without normalization: %s', requestedScope => {
    const response = giwaResult(requestedScope);
    expect(prepareGiwaMembershipProof(response, requestId, requestedScope, domain).publicInputs).toEqual(response.publicInputs);
    expect(() => prepareGiwaMembershipProof(response, requestId, requestedScope + ' ', domain)).toThrow();
  });

  it.each(['scope\nwith\ttabs', 'zero\u200bwidth', 'x'.repeat(257), ''])('refuses a requested scope the OPRF node would refuse: %j', requestedScope => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope), requestId, requestedScope, domain)).toThrow(/membership request.*scope/i);
  });

  it('preserves an identity-only signal when no deposit action was requested', () => {
    const response = giwaResult(scope);
    response.publicInputs![0] = '0xff';
    expect(prepareGiwaMembershipProof(response, requestId, scope, domain).publicInputs![0]).toBe('0xff');
  });

  it.each([32, 64])('rejects a nonzero domain/action byte at %s for identity-only membership', offset => {
    const response = giwaResult(scope);
    response.publicInputs![offset] = '0x01';
    expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow();
  });

  for (const [name, offset] of [['signal', 0], ['domain', 32], ['action', 64], ['root', 127]] as const) {
    it.each(['', ' ', '0x', '0xgg', 'xyz', '-1', '0x-1', '0x100', '0x200', '0x' + 'f'.repeat(65), null, undefined])(`rejects a malformed or out-of-byte-range ${name} field: %s`, value => {
      const response = giwaResult(scope);
      response.publicInputs![offset] = value as string;
      expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/input|byte/i);
    });
  }

  for (const [name, offset] of Object.entries(GIWA_OPRF)) {
    it.each(['', ' ', '0x', '0xgg', 'xyz', '-1', '0x-1', null, undefined])(`rejects a malformed OPRF ${name} field: %s`, value => {
      const response = giwaResult(scope);
      response.publicInputs![offset] = value as string;
      expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/not a number|membership request/i);
    });

    it(`rejects an OPRF ${name} field at or above the field modulus`, () => {
      const response = giwaResult(scope);
      response.publicInputs![offset] = '0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001';
      expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/field modulus/);
    });
  }

  it('rejects a missing nullifier field hidden in a sparse 132-element array', () => {
    const response = giwaResult(scope);
    delete response.publicInputs![GIWA_OPRF.nullifier];
    expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/not a number/i);
  });
});

describe('GIWA proof carries the pinned OPRF key and the requested domain', () => {
  it('accepts the testnet key hash and the demo domain', () => {
    const response = giwaResult(scope);
    expect(response.publicInputs![GIWA_OPRF.keyHash]).toBe(TESTNET_OPRF_KEY_HASH);
    expect(response.publicInputs![GIWA_OPRF.domain]).toBe(DEMO_DOMAIN_FIELD);
    expect(reduceOprfName(DEMO_DOMAIN)).toBe(DEMO_DOMAIN_FIELD);
    expect(prepareGiwaMembershipProof(response, requestId, scope, domain).publicInputs).toEqual(response.publicInputs);
  });

  it.each([
    ['zero', '0x' + '0'.repeat(64)],
    ['one bit off', '0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d0'],
    ['the domain field', DEMO_DOMAIN_FIELD],
  ])('refuses a proof under another OPRF key hash (%s)', (_, keyHash) => {
    const response = giwaResult(scope);
    response.publicInputs![GIWA_OPRF.keyHash] = keyHash;
    expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/OPRF key hash/);
  });

  it.each(['stg-demo.zkproofport.app', 'localhost', 'DEMO.zkproofport.app', '데모.한국'])('refuses a proof whose request named another domain (%s)', other => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope), requestId, scope, other)).toThrow(/OPRF domain/);
  });

  it('refuses a proof whose domain and scope are swapped', () => {
    const response = giwaResult(scope);
    [response.publicInputs![GIWA_OPRF.domain], response.publicInputs![GIWA_OPRF.scope]] = [response.publicInputs![GIWA_OPRF.scope], response.publicInputs![GIWA_OPRF.domain]];
    expect(() => prepareGiwaMembershipProof(response, requestId, scope, domain)).toThrow(/swapped/);
  });

  it.each(['', ' \u0000', 'a'.repeat(257)])('refuses a request domain that cannot be an OPRF name: %j', bad => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope), requestId, scope, bad)).toThrow(/OPRF/);
  });
});

describe('GIWA proof binds the Gotgan EIP-712 deposit', () => {
  it('accepts the exact domain and Deposit hash requested by the vault', () => {
    const action = depositAction();
    const result = giwaResult(scope, action);
    expect(prepareGiwaMembershipProof(result, requestId, scope, domain, action).publicInputs).toEqual(result.publicInputs);
  });

  it.each([
    ['account', '0x3333333333333333333333333333333333333333'],
    ['asset', '0x4444444444444444444444444444444444444444'],
    ['amount', '1000001'], ['nonce', '1'],
  ])('rejects a proof for a changed deposit %s', (field, value) => {
    const expected = depositAction();
    const altered = depositAction();
    altered.message[field] = value;
    expect(() => prepareGiwaMembershipProof(giwaResult(scope, altered), requestId, scope, domain, expected)).toThrow(/action/i);
  });

  it.each([
    { name: 'Other vault' }, { version: '1' }, { chainId: 84532 },
    { verifyingContract: '0x3333333333333333333333333333333333333333' },
  ])('rejects a proof from a different EIP-712 domain: %j', patch => {
    const expected = depositAction();
    const altered = depositAction();
    altered.domain = { ...altered.domain, ...patch };
    expect(() => prepareGiwaMembershipProof(giwaResult(scope, altered), requestId, scope, domain, expected)).toThrow(/domain/i);
  });

  it('rejects an identity-only proof when a deposit action was requested', () => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope), requestId, scope, domain, depositAction())).toThrow();
  });

  it('rejects a deposit proof when an identity-only proof was requested', () => {
    expect(() => prepareGiwaMembershipProof(giwaResult(scope, depositAction()), requestId, scope, domain)).toThrow();
  });

  it('rejects a nonzero signal even when domain and action match', () => {
    const action = depositAction();
    const result = giwaResult(scope, action);
    result.publicInputs![31] = '0x01';
    expect(() => prepareGiwaMembershipProof(result, requestId, scope, domain, action)).toThrow(/signal/i);
  });

  it('rejects an independently cleared action hash', () => {
    const action = depositAction();
    const result = giwaResult(scope, action);
    result.publicInputs!.splice(64, 32, ...giwaFields(ZERO_WORD));
    expect(() => prepareGiwaMembershipProof(result, requestId, scope, domain, action)).toThrow(/action/i);
  });
});
