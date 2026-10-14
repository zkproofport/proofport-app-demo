import { describe, expect, it } from 'vitest';
import { ALL_CIRCUIT_IDS, isCircuitId, type RelayProofResult } from '@zkproofport-app/sdk';
import { getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { DEMO_CIRCUITS, DEMOS, SDK_CIRCUITS_WITHOUT_A_DEMO, demoById, type DemoId } from '../lib/demo-catalog';
import { buildDemoInputs, COINBASE_SIGNER_ROOT, DEFAULT_OPTIONS, DEMO_VERIFIERS, prepareDemoProof, type DemoOptions } from '../lib/demo-policy';
import { depositAction, giwaResult } from './fixtures/giwa';

const requestId = 'request-for-this-tab';
const scope = 'unique-example-session';
const year = 2026;
const field = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const ids: DemoId[] = ['kyc', 'country', 'email', 'ownership', 'age', 'region'];

/** Per demo: how many public inputs, and where `scope` starts. Keyed, so a demo with no row is an error. */
const LAYOUT: Partial<Record<DemoId, { count: number; scopeAt: number }>> = {
  kyc: { count: 128, scopeAt: 64 }, country: { count: 150, scopeAt: 86 }, email: { count: 148, scopeAt: 83 },
  ownership: { count: 97, scopeAt: 0 }, age: { count: 66, scopeAt: 0 }, region: { count: 96, scopeAt: 0 },
};

// Public-input fixtures test the dApp's requested conditions. They deliberately
// contain no valid proof, and must still pass SDK cryptographic verification.
function fixture(id: DemoId, options: DemoOptions = DEFAULT_OPTIONS) {
  const demo = demoById(id)!;
  const layout = LAYOUT[id];
  if (!layout) throw new Error(`No public-input layout for '${id}'. Known: ${Object.keys(LAYOUT).join(', ')}.`);
  const count = layout.count;
  const publicInputs = Array.from({ length: count }, () => field(0));
  function put(start: number, bytes: Uint8Array) { bytes.forEach((value, index) => { publicInputs[start + index] = field(value); }); }
  put(layout.scopeAt, getBytes(keccak256(toUtf8Bytes(scope))));
  if (id === 'kyc' || id === 'country') put(32, getBytes(COINBASE_SIGNER_ROOT));
  if (id === 'country') {
    const countries = options.countries.split(',').map(value => value.trim().toUpperCase());
    put(64, toUtf8Bytes(countries.join('')));
    publicInputs[84] = field(countries.length);
    publicInputs[85] = field(options.inclusion ? 1 : 0);
  }
  if (id === 'email') {
    const domain = toUtf8Bytes(options.domain);
    put(18, domain); publicInputs[82] = field(domain.length);
    publicInputs[147] = field(options.provider === 'microsoft' ? 1 : 0);
  }
  if (id === 'age') { publicInputs[64] = field(Number(options.age)); publicInputs[65] = field(year); }
  if (id === 'region') {
    const region = new Uint8Array(64); region.set(toUtf8Bytes(options.region));
    put(64, getBytes(keccak256(region)));
  }
  const response: RelayProofResult = {
    requestId, circuit: demo.circuit, status: 'completed', proof: '0x1234', publicInputs,
    chainId: 84532, verifierAddress: DEMO_VERIFIERS[demo.circuit][84532],
  };
  return { response, context: { demo, requestId, scope, options: { ...options }, year } };
}

describe('dedicated circuit coverage', () => {
  it('offers one dedicated screen for every demo circuit, each one an SDK circuit', () => {
    expect(DEMOS.map(demo => demo.circuit).sort()).toEqual([...DEMO_CIRCUITS].sort());
    expect(new Set(DEMOS.map(demo => demo.id)).size).toBe(DEMOS.length);
    for (const circuit of DEMO_CIRCUITS) expect(isCircuitId(circuit), circuit).toBe(true);
    // And every SDK circuit has a tab or is listed as deliberately without one:
    // a circuit the SDK adds or drops is a decision for the demo, not something
    // it learns about from a visitor.
    const excluded: readonly string[] = SDK_CIRCUITS_WITHOUT_A_DEMO;
    for (const circuit of excluded) expect(DEMO_CIRCUITS as readonly string[], `${circuit} is both demoed and excluded`).not.toContain(circuit);
    expect([...DEMO_CIRCUITS, ...excluded].sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
  });
});

describe('Ssiat goes through its own claim policy, never the generic one', () => {
  it('builds a scope-only request for the relay check, like the other GIWA demo', () => {
    expect(buildDemoInputs(demoById('ssiat')!, DEFAULT_OPTIONS, scope)).toEqual({ scope });
  });
  it('refuses to accept a Ssiat proof through prepareDemoProof, which does not know the claim action', () => {
    const demo = demoById('ssiat')!;
    const response: RelayProofResult = { requestId, circuit: demo.circuit, status: 'completed', proof: '0x1234', publicInputs: Array(160).fill(field(0)), chainId: 91342, verifierAddress: DEMO_VERIFIERS[demo.circuit][91342] };
    expect(() => prepareDemoProof(response, { demo, requestId, scope, options: DEFAULT_OPTIONS, year })).toThrow(/prepareSsiatClaimProof/);
  });
  it('allowlists only the GIWA Sepolia Dojang Playground verifier', () => {
    expect(DEMO_VERIFIERS.dojang_playground).toEqual({ 91342: '0x2d01c2fe3445b7dde60118f956bb14e84fd64724' });
  });
});

describe('GIWA generic identity policy uses the current SDK layout', () => {
  const context = { demo: demoById('giwa')!, requestId: 'current-request', scope, options: DEFAULT_OPTIONS, year };
  it('accepts identity membership with scope at byte 128', () => {
    expect(prepareDemoProof(giwaResult(scope), context).publicInputs).toHaveLength(192);
  });
  it('rejects an action-bound deposit proof for an identity-only request', () => {
    expect(() => prepareDemoProof(giwaResult(scope, depositAction()), context)).toThrow();
  });
});

describe('requested inputs', () => {
  it('normalizes and deduplicates countries without changing inclusion mode', () => {
    expect(buildDemoInputs(demoById('country')!, { ...DEFAULT_OPTIONS, countries: ' kr, US, KR ', inclusion: false }, scope)).toEqual({ scope, countryList: ['KR', 'US'], isIncluded: false });
  });
  it('normalizes the domain and retains provider choice', () => {
    expect(buildDemoInputs(demoById('email')!, { ...DEFAULT_OPTIONS, domain: ' Example.COM ', provider: 'microsoft' }, scope)).toEqual({ scope, domain: 'example.com', provider: 'microsoft' });
  });
  it('requests no personal disclosure for ownership', () => {
    expect(buildDemoInputs(demoById('ownership')!, DEFAULT_OPTIONS, scope)).toEqual({ scope, discloseFlags: 0 });
  });
  it.each([
    ['country', { countries: '' }], ['country', { countries: 'USA' }], ['country', { countries: 'US,KR,' }],
    ['country', { countries: 'US,KR,JP,GB,DE,FR,IT,CA,AU,ES,NZ' }],
    ['email', { domain: 'person@example.com' }], ['email', { domain: 'https://example.com' }],
    ['email', { domain: '-bad.example' }], ['age', { age: '0' }], ['age', { age: '19.5' }],
    ['age', { age: '151' }], ['region', { region: 'not-a-region' }],
  ] as [DemoId, Partial<DemoOptions>][])('rejects invalid %s requirements: %j', (id, patch) => {
    expect(() => buildDemoInputs(demoById(id)!, { ...DEFAULT_OPTIONS, ...patch }, scope)).toThrow();
  });
});

describe.each(ids)('%s response policy', id => {
  it('prepares a matching proof for cryptographic verification', () => {
    const { response, context } = fixture(id);
    expect(prepareDemoProof(response, context)).toMatchObject({ requestId, circuit: context.demo.circuit, chainId: 84532 });
  });
  it('rejects a proof from another tab or request', () => {
    const { response, context } = fixture(id);
    expect(() => prepareDemoProof({ ...response, requestId: 'old-request' }, context)).toThrow('different demo request');
    expect(() => prepareDemoProof({ ...response, circuit: demoById('giwa')!.circuit }, context)).toThrow('different demo request');
  });
  it('rejects a previous attempt even if its request ID is replaced', () => {
    const { response, context } = fixture(id);
    expect(() => prepareDemoProof(response, { ...context, scope: 'different-session' })).toThrow('session');
  });
  it('rejects a caller-selected verifier or network', () => {
    const { response, context } = fixture(id);
    expect(() => prepareDemoProof({ ...response, verifierAddress: `0x${'11'.repeat(20)}` }, context)).toThrow('configured verifier');
    expect(() => prepareDemoProof({ ...response, chainId: 1 }, context)).toThrow('configured verifier');
  });
  it('rejects malformed, incomplete or failed proofs', () => {
    const { response, context } = fixture(id);
    for (const patch of [{ status: 'failed' }, { proof: '0xxyz' }, { proof: '0x1' }, { publicInputs: [] }, { publicInputs: response.publicInputs!.map(() => 'garbage') }]) {
      expect(() => prepareDemoProof({ ...response, ...patch } as RelayProofResult, context)).toThrow();
    }
  });
});

describe('predicate substitution', () => {
  it.each(['kyc', 'country'] as DemoId[])('rejects a different attester for %s', id => {
    const { response, context } = fixture(id); response.publicInputs![32] = field(0);
    expect(() => prepareDemoProof(response, context)).toThrow('attester');
  });
  it('accepts an exclusion proof only for the matching exclusion request', () => {
    const { response, context } = fixture('country', { ...DEFAULT_OPTIONS, inclusion: false });
    expect(prepareDemoProof(response, context)).toBeDefined();
    expect(() => prepareDemoProof(response, { ...context, options: DEFAULT_OPTIONS })).toThrow('country policy');
  });
  it('checks every country and the list length', () => {
    const { response, context } = fixture('country'); response.publicInputs![65] = field(65);
    expect(() => prepareDemoProof(response, context)).toThrow('different country list');
    response.publicInputs![84] = field(2);
    expect(() => prepareDemoProof(response, context)).toThrow('country policy');
  });
  it('matches both the domain and the provider', () => {
    const { response, context } = fixture('email');
    expect(() => prepareDemoProof(response, { ...context, options: { ...DEFAULT_OPTIONS, domain: 'another.com' } })).toThrow('domain and provider');
    expect(() => prepareDemoProof(response, { ...context, options: { ...DEFAULT_OPTIONS, provider: 'microsoft' } })).toThrow('domain and provider');
  });
  it('rejects a malformed domain length', () => {
    const { response, context } = fixture('email'); response.publicInputs![82] = field(65);
    expect(() => prepareDemoProof(response, context)).toThrow('invalid length');
  });
  it('does not accept disclosed personal fields for the anonymous pass', () => {
    const { response, context } = fixture('ownership'); response.publicInputs![64] = field(1);
    expect(() => prepareDemoProof(response, context)).toThrow('anonymous');
  });
  it('binds both threshold and current year', () => {
    const { response, context } = fixture('age');
    expect(() => prepareDemoProof(response, { ...context, options: { ...DEFAULT_OPTIONS, age: '21' } })).toThrow('threshold and year');
    expect(() => prepareDemoProof(response, { ...context, year: year + 1 })).toThrow('threshold and year');
  });
  it('matches the padded UTF-8 region hash, not just any residency proof', () => {
    const { response, context } = fixture('region');
    expect(() => prepareDemoProof(response, { ...context, options: { ...DEFAULT_OPTIONS, region: '부산광역시' } })).toThrow('region');
  });
  it('rejects a field masquerading as a byte', () => {
    const { response, context } = fixture('region'); response.publicInputs![0] = field(256);
    expect(() => prepareDemoProof(response, context)).toThrow('invalid byte');
  });
});
