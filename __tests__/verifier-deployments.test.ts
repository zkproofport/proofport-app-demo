import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GIWA_PUBLIC_INPUT_COUNT, GIWA_VERIFIER } from '../lib/giwa-membership';
import { SSIAT_PUBLIC_INPUT_COUNT, SSIAT_VERIFIER } from '../lib/ssiat-drop';
import { PINNED_VERIFIERS, getPinnedVariantVerifier, getPinnedVerifier, signerVariantsOf } from '@zkproofport-app/sdk';
import { VERIFIER_DEPLOYMENTS, variantVerifierAddress, verifierAddress } from '../lib/verifier-deployments';
import { getPinnedOprfKeyHash, OPRF_FIELD_MODULUS, OPRF_PUBLIC_INPUT_LAYOUTS } from '@zkproofport-app/core';
import { DEMO_OPRF_DOMAIN, oprfEnvironmentForChain } from '../lib/oprf';

// The circuits repository is a sibling checkout. Its records are read from
// origin/main with `git show`, so the answer does not depend on which branch
// that checkout happens to be on. CIRCUITS_REF overrides the ref.
const REF = process.env.CIRCUITS_REF ?? 'origin/main';
function readRecord(path: string): string | undefined {
  try {
    return execFileSync('git', ['-C', '../circuits', 'show', `${REF}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return undefined; }
}
const available = readRecord('deployments/84532/CoinbaseAttestation.json') !== undefined;

function recordedAddress(path: string): string {
  const text = readRecord(path);
  if (text === undefined) throw new Error(`Record ${path} not found at ${REF} in ../circuits.`);
  const json = JSON.parse(text);
  if (path.startsWith('broadcast/')) {
    const created = json.transactions.filter((t: { transactionType: string; contractName: string }) => t.transactionType === 'CREATE' && t.contractName === 'HonkVerifier');
    if (created.length !== 1) throw new Error(`${path} must hold exactly one HonkVerifier CREATE, found ${created.length}.`);
    return created[0].contractAddress.toLowerCase();
  }
  if (!json.address) throw new Error(`${path} has no address.`);
  return String(json.address).toLowerCase();
}

// A pinned verifier built from a verification key that is no longer the
// circuit's (the mainnet ones until their redeploy) is refused by core, by
// name. Those pairs are collected and held to that refusal; every other pair
// must resolve.
const AWAITS_REDEPLOY = /awaits a redeploy/;
const awaiting: { circuit: string; chain: number; variant: string; error: string }[] = [];
function resolve<T>(circuit: string, chain: number, variant: string, read: () => T): T[] {
  try { return [read()]; } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    if (!AWAITS_REDEPLOY.test(error)) throw cause;
    awaiting.push({ circuit, chain, variant, error });
    return [];
  }
}
const rows = Object.entries(VERIFIER_DEPLOYMENTS).flatMap(([circuit, chains]) => chains.flatMap(chain =>
  resolve(circuit, chain, 'standard', () => ({ circuit, chain, address: verifierAddress(circuit, chain), record: getPinnedVerifier(circuit, chain).record }))));
// Every other package (an Android signer's) of every accepted pair: its own verifier, its own record.
const variantRows = Object.entries(VERIFIER_DEPLOYMENTS).flatMap(([circuit, chains]) =>
  signerVariantsOf(circuit).filter(variant => variant !== 'standard').flatMap(variant => chains.flatMap(chain => resolve(circuit, chain, variant, () => ({
    circuit, chain, variant, address: variantVerifierAddress(circuit, chain, variant), record: getPinnedVariantVerifier(circuit, variant, chain).record,
  })))));

describe('verifiers awaiting a redeploy are refused by name, never replaced', () => {
  it('are exactly the Base mainnet rows, until the mainnet redeploy', () => {
    expect(awaiting.length).toBeGreaterThan(0);
    for (const row of awaiting) expect(row.chain, `${row.circuit} (${row.variant})`).toBe(8453);
    expect(rows.every(r => r.chain !== 8453)).toBe(true);
  });
  it.each(awaiting.map(row => [`${row.circuit} (${row.variant}) on ${row.chain}`, row] as const))('%s', (_name, row) => {
    expect(row.error).toMatch(new RegExp(`^The ${row.circuit} verifier (for the '${row.variant}' signer )?on chain ${row.chain} awaits a redeploy`));
  });
});

describe('verifier table', () => {
  it('lists lowercase 20-byte addresses, each exactly once', () => {
    for (const r of rows) expect(r.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(new Set(rows.map(r => r.address)).size).toBe(rows.length);
  });
  it('feeds every consumer from the one table', () => {
    expect(GIWA_VERIFIER).toBe(verifierAddress('giwa_attestation', 91342));
    expect(SSIAT_VERIFIER).toBe(verifierAddress('dojang_playground', 91342));
  });
  it('has a distinct verifier for every other package of every accepted pair', () => {
    expect(variantRows.length).toBeGreaterThan(0);
    for (const r of variantRows) expect(r.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(new Set([...rows, ...variantRows].map(r => r.address)).size).toBe(rows.length + variantRows.length);
    expect(() => variantVerifierAddress('human_passport_score', 84532, 'android')).toThrow(/android/);
    expect(() => variantVerifierAddress('coinbase_attestation', 11155111, 'android')).toThrow(/Known chains: 8453, 84532/);
  });
  it('takes every address from core\'s pinned table, not a copy', () => {
    for (const r of rows) expect(r.address).toBe((PINNED_VERIFIERS as Record<string, Record<number, { address: string }>>)[r.circuit][r.chain].address);
  });
  it.each([
    ['no_such_circuit', 84532, /No verifier table for circuit 'no_such_circuit'/],
    // Core pins these, but the demo does not accept them: the allowlist decides, not core's reach.
    ['coinbase_attestation', 1, /No coinbase_attestation verifier on chain 1\. Known chains: 8453, 84532/],
    ['coinbase_attestation', 11155111, /No coinbase_attestation verifier on chain 11155111/],
    ['mdl_kr_age', 84532, /No verifier table for circuit 'mdl_kr_age'\. Known: giwa_attestation, dojang_playground, coinbase_attestation, coinbase_country_attestation, oidc_domain_attestation, human_passport_score\.$/],
    // Core pins Human Passport on Sepolia too; the app verifies it on Base and Base Sepolia only.
    ['human_passport_score', 11155111, /No human_passport_score verifier on chain 11155111\. Known chains: 8453, 84532/],
    ['human_passport_score', 10, /No human_passport_score verifier on chain 10\./],
    ['__proto__', 84532, /No verifier table for circuit '__proto__'/],
    ['constructor', 84532, /No verifier table for circuit 'constructor'/],
    ['코인베이스', 84532, /No verifier table for circuit '코인베이스'/],
    ['', 84532, /No verifier table for circuit ''/],
    ['coinbase_attestation', 0, /on chain 0/],
    ['coinbase_attestation', -84532, /on chain -84532/],
    ['coinbase_attestation', 84532.5, /on chain 84532.5/],
    ['coinbase_attestation', Number.NaN, /on chain NaN/],
    ['coinbase_attestation', '84532' as unknown as number, /on chain 84532/],
  ] as const)('throws for an unknown key %s/%s', (circuit, chain, message) => {
    expect(() => verifierAddress(circuit, chain)).toThrow(message);
  });
});

// The vault and the drop hold their verifier as an immutable constant. A contract
// compiled against a retired verifier deploys fine and then refuses every new proof,
// so the source must name the same verifier and layout the demo checks proofs against.
function solidityConstant(file: string, name: string): string {
  const match = readFileSync(`contracts/src/${file}`, 'utf8').match(new RegExp(`\\b${name}\\s*=\\s*(\\w+);`));
  if (!match) throw new Error(`${name} not found in contracts/src/${file}.`);
  return match[1];
}
function solidityString(file: string, name: string): string {
  const match = readFileSync(`contracts/src/${file}`, 'utf8').match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)";`));
  if (!match) throw new Error(`${name} not found in contracts/src/${file}.`);
  return match[1];
}
describe('demo contracts are built against the table', () => {
  it.each([
    ['GiwaDemoVault.sol', 'giwa_attestation', GIWA_PUBLIC_INPUT_COUNT],
    ['SsiatDrop.sol', 'dojang_playground', SSIAT_PUBLIC_INPUT_COUNT],
  ] as const)('%s uses the %s verifier, its public-input count, and the pinned OPRF key and demo domain', (file, circuit, count) => {
    expect(solidityConstant(file, 'VERIFIER').toLowerCase()).toBe(verifierAddress(circuit, 91342));
    expect(Number(solidityConstant(file, 'PUBLIC_INPUT_COUNT'))).toBe(count);
    expect(solidityConstant(file, 'OPRF_KEY_HASH').toLowerCase()).toBe(getPinnedOprfKeyHash(oprfEnvironmentForChain(91342), circuit));
    expect(solidityString(file, 'OPRF_DOMAIN')).toBe(DEMO_OPRF_DOMAIN);
    expect(BigInt(solidityConstant(file, 'FIELD_MODULUS'))).toBe(OPRF_FIELD_MODULUS);
    // The offsets the contract reads are core's, for this circuit.
    const layout = OPRF_PUBLIC_INPUT_LAYOUTS[circuit];
    expect(Number(solidityConstant(file, 'OPRF_KEY_HASH_INDEX'))).toBe(layout.keyHash);
    expect(Number(solidityConstant(file, 'OPRF_DOMAIN_INDEX'))).toBe(layout.domain);
    expect(Number(solidityConstant(file, 'SCOPE_INDEX'))).toBe(layout.scope);
    expect(Number(solidityConstant(file, 'BYTE_FIELDS'))).toBe(layout.keyHash);
  });
  it('SsiatDrop reads the nullifier where core says it is', () => {
    expect(Number(solidityConstant('SsiatDrop.sol', 'NULLIFIER_INDEX'))).toBe(OPRF_PUBLIC_INPUT_LAYOUTS.dojang_playground.nullifier);
  });
});

// Visible skip, not a silent pass, when the circuits checkout is absent.
describe.skipIf(!available)(`verifier table matches the circuits deployment records (../circuits ${REF})`, () => {
  it.each(rows.map(r => [`${r.circuit} on ${r.chain}`, r] as const))('%s', (_name, r) => {
    expect(r.address).toBe(recordedAddress(r.record));
  });
  it.each(variantRows.map(r => [`${r.circuit} (${r.variant}) on ${r.chain}`, r] as const))('%s', (_name, r) => {
    expect(r.address).toBe(recordedAddress(r.record));
  });
});
