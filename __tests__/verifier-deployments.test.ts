import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_VERIFIERS } from '../lib/demo-policy';
import { GIWA_PUBLIC_INPUT_COUNT, GIWA_VERIFIER } from '../lib/giwa-membership';
import { SSIAT_PUBLIC_INPUT_COUNT, SSIAT_VERIFIER } from '../lib/ssiat-drop';
import { VERIFIER_DEPLOYMENTS, verifierAddress } from '../lib/verifier-deployments';

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

const rows = Object.entries(VERIFIER_DEPLOYMENTS).flatMap(([circuit, byChain]) =>
  Object.entries(byChain).map(([chain, row]) => ({ circuit, chain: Number(chain), ...row })));

describe('verifier table', () => {
  it('lists lowercase 20-byte addresses, each exactly once', () => {
    for (const r of rows) expect(r.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(new Set(rows.map(r => r.address)).size).toBe(rows.length);
  });
  it('feeds every consumer from the one table', () => {
    for (const r of rows) expect(DEMO_VERIFIERS[r.circuit as keyof typeof DEMO_VERIFIERS][r.chain]).toBe(r.address);
    expect(GIWA_VERIFIER).toBe(verifierAddress('giwa_attestation', 91342));
    expect(SSIAT_VERIFIER).toBe(verifierAddress('dojang_playground', 91342));
  });
  it.each([['no_such_circuit', 84532, /No verifier table for circuit 'no_such_circuit'/], ['coinbase_attestation', 1, /No coinbase_attestation verifier on chain 1/]] as const)(
    'throws for an unknown key %s/%s', (circuit, chain, message) => {
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
describe('demo contracts are built against the table', () => {
  it.each([
    ['GiwaDemoVault.sol', 'giwa_attestation', GIWA_PUBLIC_INPUT_COUNT],
    ['SsiatDrop.sol', 'dojang_playground', SSIAT_PUBLIC_INPUT_COUNT],
  ] as const)('%s uses the %s verifier and its public-input count', (file, circuit, count) => {
    expect(solidityConstant(file, 'VERIFIER').toLowerCase()).toBe(verifierAddress(circuit, 91342));
    expect(Number(solidityConstant(file, 'PUBLIC_INPUT_COUNT'))).toBe(count);
  });
});

// Visible skip, not a silent pass, when the circuits checkout is absent.
describe.skipIf(!available)(`verifier table matches the circuits deployment records (../circuits ${REF})`, () => {
  it.each(rows.map(r => [`${r.circuit} on ${r.chain}`, r] as const))('%s', (_name, r) => {
    expect(r.address).toBe(recordedAddress(r.record));
  });
});
