import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CIRCUIT_IDS, getPinnedVariantVerifier, getPinnedVerifier, HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT, type ProofResponse } from '@zkproofport-app/sdk';
import { COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT, computeSignalHash, OPRF_PUBLIC_INPUT_LAYOUTS, reduceOprfName } from '@zkproofport-app/core';
import { TESTNET_OPRF_KEY_HASH } from './fixtures/giwa';
import { proofHex } from './fixtures/card-proofs';
import { getAddress, getBytes, keccak256 } from 'ethers';
import { DEMO_OPRF_DOMAIN } from '../lib/oprf';
import { COINBASE_SIGNER_ROOT } from '../lib/demo-policy';
import { GIWA_SIGNER_ROOT } from '../lib/giwa-membership';
import { createVerifierSDK } from '../lib/sdk';

const field = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const known = (circuit: string) => (ALL_CIRCUIT_IDS as readonly string[]).includes(circuit);
/** The address a response would name; none for a pair core does not pin, so the demo's own refusal is what the test sees. */
function pinnedOrNone(circuit: string, chainId: number): string | undefined {
  try { return getPinnedVerifier(circuit, chainId).address; } catch { return undefined; }
}
/**
 * The request every wallet proof below answers. Since SDK 0.5.0-beta.13 a fresh
 * SDK refuses a wallet proof it cannot place, and compares its signal_hash
 * (keccak256(scope, circuit, requestId)) with the request's; the inputs below
 * carry the right one, so the checks after it are what each test reaches.
 */
const REQUEST = { scope: 's', requestId: 'r', oprfDomain: DEMO_OPRF_DOMAIN };
/**
 * Zero public inputs of `count`; for a wallet credential, the signal hash of
 * REQUEST in bytes 0..31 and the testnet OPRF key, REQUEST's domain and scope
 * and a nullifier at the circuit's own OPRF offsets.
 */
function inputsFor(circuit: string, count: number): string[] {
  const inputs = Array.from({ length: count }, () => field(0));
  const layout = known(circuit) ? (OPRF_PUBLIC_INPUT_LAYOUTS as Record<string, { keyHash: number; domain: number; scope: number; nullifier: number } | null>)[circuit] : null;
  if (!layout) return inputs;
  getBytes(computeSignalHash({ scope: REQUEST.scope, circuitId: circuit, requestId: REQUEST.requestId })).forEach((byte, index) => { inputs[index] = field(byte); });
  inputs[layout.keyHash] = TESTNET_OPRF_KEY_HASH;
  inputs[layout.domain] = reduceOprfName(REQUEST.oprfDomain);
  inputs[layout.scope] = reduceOprfName(REQUEST.scope);
  inputs[layout.nullifier] = field(7);
  return inputs;
}
function proof(overrides: Partial<ProofResponse> = {}): ProofResponse {
  const circuit = overrides.circuit ?? 'coinbase_attestation';
  const chainId = 'chainId' in overrides ? overrides.chainId : 84532;
  return {
    requestId: 'r', circuit, status: 'completed', proof: known(circuit) ? proofHex(circuit) : '0x1234', publicInputs: inputsFor(circuit, COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT),
    chainId, verifierAddress: 'verifierAddress' in overrides || chainId === undefined ? overrides.verifierAddress : pinnedOrNone(circuit, chainId), ...overrides,
  };
}

// A provider that fails the test if verification gets as far as asking a chain.
const untouchable = new Proxy({}, { get(_target, key) { throw new Error(`provider touched: ${String(key)}`); } });

describe('createVerifierSDK: the on-chain verifier is core\'s pinned deployment', () => {
  it('configures coinbase_attestation on chain 84532 with the pinned address', () => {
    const sdk = createVerifierSDK(proof({ chainId: 84532 }));
    expect(sdk.getVerifierAddress('coinbase_attestation')).toBe(getPinnedVerifier('coinbase_attestation', 84532).address);
    expect(sdk.getVerifierChainId('coinbase_attestation')).toBe(84532);
  });

  it('refuses a Base mainnet proof by name while its verifier awaits a redeploy', () => {
    expect(() => createVerifierSDK(proof({ chainId: 8453, verifierAddress: '0x6fc22d3576fb70457d1529b3f70f711a3cba7a7f' }))).toThrow(/awaits a redeploy/);
  });

  it('any other circuit resolves only to core\'s pin for the environment the proof\'s chain implies', () => {
    // The SDK needs that environment to know whose OPRF key a wallet proof must carry.
    expect(createVerifierSDK(proof()).getVerifierAddress('oidc_domain_attestation')).toBe(getPinnedVerifier('oidc_domain_attestation', 84532).address);
  });

  it('refuses a proof under another OPRF key before any chain is asked', async () => {
    const foreign = proof();
    foreign.publicInputs = [...foreign.publicInputs!];
    foreign.publicInputs[OPRF_PUBLIC_INPUT_LAYOUTS.coinbase_attestation.keyHash] = field(1);
    const result = await createVerifierSDK(foreign).verifyResponseOnChain(foreign, untouchable, { request: REQUEST });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/OPRF key hash .* is not the key pinned for coinbase_attestation in 'staging'/);
  });

  it('refuses a proof keyed by another OPRF domain than the request named', async () => {
    const result = await createVerifierSDK(proof()).verifyResponseOnChain(proof(), untouchable, { request: { ...REQUEST, oprfDomain: 'stg-demo.zkproofport.app' } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/OPRF domain/);
  });

  it.each([
    [{ chainId: undefined }, /names no chain/],
    [{ chainId: 1 }, /No coinbase_attestation verifier on chain 1/],
    [{ chainId: 11155111 }, /No coinbase_attestation verifier on chain 11155111/],
    [{ chainId: 0 }, /on chain 0/],
    [{ chainId: '84532' as unknown as number }, /on chain 84532/],
    [{ circuit: 'no_such_circuit' as ProofResponse['circuit'], verifierAddress: undefined }, /No verifier table for circuit 'no_such_circuit'/],
    [{ signerVariant: 'ios' }, /no "ios" signer variant/],
    [{ signerVariant: 'android' }, /coinbase_attestation/],
  ] as const)('throws, naming the key, for %o', (overrides, message) => {
    expect(() => createVerifierSDK(proof(overrides as Partial<ProofResponse>))).toThrow(message);
  });

  it('refuses a response that names a different verifier, before any chain is asked', async () => {
    const tampered = proof({ verifierAddress: '0x000000000000000000000000000000000000dEaD' });
    const result = await createVerifierSDK(tampered).verifyResponseOnChain(tampered, untouchable, { request: REQUEST });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/0x000000000000000000000000000000000000dead/i);
  });

  it('accepts the pinned address in checksum case, then runs the signer-root check before the chain', async () => {
    const checksummed = proof({ verifierAddress: getAddress(getPinnedVerifier('coinbase_attestation', 84532).address) });
    const result = await createVerifierSDK(checksummed).verifyResponseOnChain(checksummed, untouchable, { request: REQUEST });
    // All-zero public inputs carry a zero signer root: refused by the issuer check, not by the address.
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Coinbase/);
    expect(result.error).not.toMatch(/provider touched/);
  });
});

describe('a wallet proof is verified against the request it answers', () => {
  it('the published SDK refuses a wallet proof a fresh SDK cannot place', async () => {
    const result = await createVerifierSDK(proof()).verifyResponseOnChain(proof(), untouchable);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/No request "r" was created by this SDK instance.*oprfDomain/);
  });
  it('and one whose signal hash belongs to another request', async () => {
    const result = await createVerifierSDK(proof()).verifyResponseOnChain(proof(), untouchable, { request: { ...REQUEST, scope: 'another' } });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signal_hash/);
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
    for (const call of onchain) expect(call).toMatch(/^\.verifyResponseOnChain\(\w+, undefined, \{ request, \.\.\.conditions \}\)$/);
    for (const call of offchain) expect(call).toMatch(/^\.verifyResponseOffChain\(\w+, \{ request, \.\.\.conditions \}\)$/);
  });

  it('app/page.tsx records the request id of every card it creates a relay request for', () => {
    const source = readFileSync('app/page.tsx', 'utf8');
    const created = source.match(/sdk\.createRelayRequest\(/g) ?? [];
    const recorded = source.match(/madeRequestIdsRef\.current\.(kyc|country|email|giwa) = result\.requestId;/g) ?? [];
    expect(created.length).toBe(4);
    expect(new Set(recorded).size).toBe(created.length);
  });
});

// Human Passport: the threshold is a public input the prover chose, so a fresh
// SDK refuses to verify until it is told what was asked.
describe('a Human Passport proof is verified against the threshold the request asked for', () => {
  const passport = (chainId = 84532) => proof({
    circuit: 'human_passport_score', chainId, publicInputs: inputsFor('human_passport_score', HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT),
  });
  it('configures the pinned Human Passport verifier on chain 84532', () => {
    expect(createVerifierSDK(passport(84532)).getVerifierAddress('human_passport_score')).toBe(getPinnedVerifier('human_passport_score', 84532).address);
  });
  it('the published SDK refuses it without a threshold', async () => {
    const result = await createVerifierSDK(passport()).verifyResponseOnChain(passport(), untouchable, { request: REQUEST });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/minScore/);
  });
  it('with the threshold, it reaches the issuer check (all-zero inputs: refused there, never at the chain)', async () => {
    const result = await createVerifierSDK(passport()).verifyResponseOnChain(passport(), untouchable, { request: REQUEST, minScore: 20 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Human Passport/);
    expect(result.error).not.toMatch(/minScore|provider touched/);
  });
});

// An Android signer's proof has its own verifier, which a configured verifier
// (standard package only) cannot be; the SDK picks it from the chain's environment.
describe('an Android-signed proof is verified against its own package\'s verifier', () => {
  const android = (chainId: number) => proof({
    chainId, signerVariant: 'android', proof: proofHex('coinbase_attestation', 'android'),
    verifierAddress: getPinnedVariantVerifier('coinbase_attestation', 'android', chainId).address,
  });
  it.each([[84532]])('on chain %s: the Android verifier is accepted, then the issuer check runs before the chain', async chainId => {
    const result = await createVerifierSDK(android(chainId)).verifyResponseOnChain(android(chainId), untouchable, { request: REQUEST });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Coinbase/);
    expect(result.error).not.toMatch(/provider touched|verifies against/);
  });
  it('refuses an Android proof that names the standard verifier', async () => {
    const tampered = { ...android(84532), verifierAddress: getPinnedVerifier('coinbase_attestation', 84532).address };
    const result = await createVerifierSDK(tampered).verifyResponseOnChain(tampered, untouchable, { request: REQUEST });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/verifies against/);
  });
  it('refuses a Base mainnet Android proof by name while its verifier awaits a redeploy', () => {
    expect(() => getPinnedVariantVerifier('coinbase_attestation', 'android', 8453)).toThrow(/awaits a redeploy/);
  });
});
