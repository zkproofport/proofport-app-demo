import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getPinnedVerifier, type ProofResponse } from '@zkproofport-app/sdk';
import { getAddress, keccak256 } from 'ethers';
import { COINBASE_SIGNER_ROOT } from '../lib/demo-policy';
import { GIWA_SIGNER_ROOT } from '../lib/giwa-membership';
import { createVerifierSDK } from '../lib/sdk';

const field = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
function proof(overrides: Partial<ProofResponse> = {}): ProofResponse {
  const circuit = overrides.circuit ?? 'coinbase_attestation';
  const chainId = 'chainId' in overrides ? overrides.chainId : 84532;
  return {
    requestId: 'r', circuit, status: 'completed', proof: '0x1234', publicInputs: Array.from({ length: 128 }, () => field(0)),
    chainId, verifierAddress: 'verifierAddress' in overrides || chainId === undefined ? overrides.verifierAddress : getPinnedVerifier(circuit, chainId).address, ...overrides,
  };
}

// A provider that fails the test if verification gets as far as asking a chain.
const untouchable = new Proxy({}, { get(_target, key) { throw new Error(`provider touched: ${String(key)}`); } });

describe('createVerifierSDK: the on-chain verifier is core\'s pinned deployment', () => {
  it.each([[84532], [8453]])('configures coinbase_attestation on chain %s with the pinned address', chainId => {
    const sdk = createVerifierSDK(proof({ chainId }));
    expect(sdk.getVerifierAddress('coinbase_attestation')).toBe(getPinnedVerifier('coinbase_attestation', chainId).address);
    expect(sdk.getVerifierChainId('coinbase_attestation')).toBe(chainId);
  });

  it('configures only the proof\'s circuit, so another circuit is not silently verifiable', () => {
    expect(() => createVerifierSDK(proof()).getVerifierAddress('oidc_domain_attestation')).toThrow(/No verifier configured for circuit 'oidc_domain_attestation'/);
  });

  it.each([
    [{ chainId: undefined }, /names no chain/],
    [{ chainId: 1 }, /No coinbase_attestation verifier on chain 1/],
    [{ chainId: 11155111 }, /No coinbase_attestation verifier on chain 11155111/],
    [{ chainId: 0 }, /on chain 0/],
    [{ chainId: '84532' as unknown as number }, /on chain 84532/],
    [{ circuit: 'no_such_circuit' as ProofResponse['circuit'], verifierAddress: undefined }, /No verifier table for circuit 'no_such_circuit'/],
  ] as const)('throws, naming the key, for %o', (overrides, message) => {
    expect(() => createVerifierSDK(proof(overrides as Partial<ProofResponse>))).toThrow(message);
  });

  it('refuses a response that names a different verifier, before any chain is asked', async () => {
    const tampered = proof({ verifierAddress: '0x000000000000000000000000000000000000dEaD' });
    const result = await createVerifierSDK(tampered).verifyResponseOnChain(tampered, untouchable);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/0x000000000000000000000000000000000000dead/i);
  });

  it('accepts the pinned address in checksum case, then runs the signer-root check before the chain', async () => {
    const checksummed = proof({ verifierAddress: getAddress(getPinnedVerifier('coinbase_attestation', 84532).address) });
    const result = await createVerifierSDK(checksummed).verifyResponseOnChain(checksummed, untouchable);
    // All-zero public inputs carry a zero signer root: refused by the issuer check, not by the address.
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Coinbase/);
    expect(result.error).not.toMatch(/provider touched/);
  });
});

describe('signer roots come from core and are the sets the demo was built for', () => {
  it('Coinbase: the four-signer tree the demo used to build by hand', () => {
    expect(COINBASE_SIGNER_ROOT).toBe('0xb60da9815c76261b61a1e91f199de5845fc171a6500e57c4240d2ac61d85e2bf');
  });
  it('GIWA: the one test attester', () => {
    expect(GIWA_SIGNER_ROOT).toBe(keccak256('0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b'));
  });
});

// Source guard for the call sites no render test reaches (app/page.tsx). Every
// on-chain verification must go through createVerifierSDK: the relay SDK has
// no verifier configured, and SDK 0.5.0-beta.2 answers "No verifier chosen".
describe('every on-chain verification uses the pinned-verifier SDK', () => {
  it.each(['app/page.tsx', 'lib/useCredentialDemo.ts'])('%s', file => {
    const source = readFileSync(file, 'utf8').split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    const calls = source.match(/[\w.()]+\s*\.verifyResponseOnChain\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/^createVerifierSDK\(\w+\)\.verifyResponseOnChain\($/);
  });
});

// OIDC v2 (core 0.3.0, SDK 0.5.0-beta.3): a proof made by the app carries a
// nonce bound to keccak256(scope) and the relay requestId. The on-chain path
// verifies through a fresh SDK (createVerifierSDK) that never created the
// request, so unless the demo names the request the published SDK refuses.
describe('an OIDC proof is verified against the request it answers', () => {
  const requestId = '0b6f4c1e-8f5a-4d2b-9c3e-7a1d2f3b4c5d';
  const oidc = () => proof({ circuit: 'oidc_domain_attestation', requestId, publicInputs: Array.from({ length: 214 }, () => field(0)) });

  it('the published SDK refuses an OIDC response from a request this SDK instance did not create', async () => {
    const result = await createVerifierSDK(oidc()).verifyResponseOnChain(oidc(), untouchable);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No request .* was created by this SDK instance/);
  });

  it('refuses a request that is not the one the response answers', async () => {
    const result = await createVerifierSDK(oidc()).verifyResponseOnChain(oidc(), untouchable, { request: { scope: 's', requestId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/is not the one this response answers/);
  });

  it('with the request named, it reaches the policy check (all-zero inputs: refused there, never at the chain)', async () => {
    const result = await createVerifierSDK(oidc()).verifyResponseOnChain(oidc(), untouchable, { request: { scope: 's', requestId } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/audience/);
    expect(result.error).not.toMatch(/No request|is not the one|provider touched/);
  });
});

// Source guard, same reason as above: every verify call on both pages names
// the request, so an OIDC proof's nonce binding is checked on every path.
describe('every verification call passes the request', () => {
  it.each(['app/page.tsx', 'lib/useCredentialDemo.ts'])('%s', file => {
    const source = readFileSync(file, 'utf8').split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    const onchain = source.match(/\.verifyResponseOnChain\([^)]*\)/g) ?? [];
    const offchain = source.match(/\.verifyResponseOffChain\([^)]*\)/g) ?? [];
    expect(onchain.length + offchain.length).toBeGreaterThan(1);
    for (const call of onchain) expect(call).toMatch(/^\.verifyResponseOnChain\(\w+, undefined, \{ request \}\)$/);
    for (const call of offchain) expect(call).toMatch(/^\.verifyResponseOffChain\(\w+, \{ request \}\)$/);
  });

  it('app/page.tsx records the request id of every card it creates a relay request for', () => {
    const source = readFileSync('app/page.tsx', 'utf8');
    const created = source.match(/sdk\.createRelayRequest\(/g) ?? [];
    const recorded = source.match(/madeRequestIdsRef\.current\.(kyc|country|email|mdl|giwa) = result\.requestId;/g) ?? [];
    expect(created.length).toBe(5);
    expect(new Set(recorded).size).toBe(created.length);
  });
});
