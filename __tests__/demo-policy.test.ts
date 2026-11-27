import { describe, expect, it } from 'vitest';
import {
  ALL_CIRCUIT_IDS, COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT as KYC, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT as PASSPORT, OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as OIDC,
  isCircuitId, type RelayProofResult,
} from '@zkproofport-app/sdk';
import { DEMO_CIRCUITS, DEMOS, SDK_CIRCUITS_WITHOUT_A_DEMO, demoById, type DemoId } from '../lib/demo-catalog';
import { buildDemoInputs, DEFAULT_OPTIONS, parseMinScore, prepareDemoProof, verificationConditions, type DemoOptions } from '../lib/demo-policy';
import { variantVerifierAddress, verifierAddress } from '../lib/verifier-deployments';
import { DEMO_DOMAIN, DEMO_DOMAIN_FIELD, depositAction, giwaResult, TESTNET_OPRF_KEY_HASH } from './fixtures/giwa';
import { cardResult, field, LAYOUT, proofHex, type CardDemo } from './fixtures/card-proofs';

const requestId = 'request-for-this-tab';
const scope = 'unique-example-session';
const ids: CardDemo[] = ['kyc', 'country', 'email', 'passport'];

function fixture(id: CardDemo, options: DemoOptions = DEFAULT_OPTIONS) {
  const demo = demoById(id)!;
  return { response: cardResult(id, requestId, scope, options), context: { demo, requestId, scope, options: { ...options } } };
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
  it('builds a scope-and-domain request for the relay check, like the other GIWA demo', () => {
    expect(buildDemoInputs(demoById('ssiat')!, DEFAULT_OPTIONS, scope)).toEqual({ scope, oprfDomain: DEMO_DOMAIN });
  });
  it('refuses to accept a Ssiat proof through prepareDemoProof, which does not know the claim action', () => {
    const demo = demoById('ssiat')!;
    const response: RelayProofResult = { requestId, circuit: demo.circuit, status: 'completed', proof: proofHex(demo.circuit), publicInputs: Array(101).fill(field(0)), chainId: 91342, verifierAddress: verifierAddress(demo.circuit, 91342) };
    expect(() => prepareDemoProof(response, { demo, requestId, scope, options: DEFAULT_OPTIONS })).toThrow(/prepareSsiatClaimProof/);
  });
  it('allowlists only the GIWA Sepolia Dojang Playground verifier', () => {
    expect(verifierAddress('dojang_playground', 91342)).toBe('0xc1c42ade7c31afdf99fbaedf97da5b07fccba724');
    for (const chain of [8453, 84532]) expect(() => verifierAddress('dojang_playground', chain)).toThrow(/Known chains: 91342/);
  });
});

describe('GIWA generic identity policy uses the current SDK layout', () => {
  const context = { demo: demoById('giwa')!, requestId: 'current-request', scope, options: DEFAULT_OPTIONS };
  it('accepts identity membership with the OPRF fields at 128..131', () => {
    expect(prepareDemoProof(giwaResult(scope), context).publicInputs).toHaveLength(133);
  });
  it('rejects an action-bound deposit proof for an identity-only request', () => {
    expect(() => prepareDemoProof(giwaResult(scope, depositAction()), context)).toThrow();
  });
});

describe('requested inputs', () => {
  it('normalizes and deduplicates countries without changing inclusion mode', () => {
    expect(buildDemoInputs(demoById('country')!, { ...DEFAULT_OPTIONS, countries: ' kr, US, KR ', inclusion: false }, scope)).toEqual({ scope, oprfDomain: DEMO_DOMAIN, countryList: ['KR', 'US'], isIncluded: false });
  });
  it('normalizes the domain and retains provider choice', () => {
    expect(buildDemoInputs(demoById('email')!, { ...DEFAULT_OPTIONS, domain: ' Example.COM ', provider: 'microsoft' }, scope)).toEqual({ scope, domain: 'example.com', provider: 'microsoft' });
  });
  it('asks for the typed score threshold for passport, as a number of points', () => {
    expect(buildDemoInputs(demoById('passport')!, { ...DEFAULT_OPTIONS, minScore: ' 20.5 ' }, scope)).toEqual({ scope, oprfDomain: DEMO_DOMAIN, minScore: 20.5 });
  });
  it.each(['kyc', 'giwa', 'ssiat'] as DemoId[])('requests only the scope and the OPRF domain for %s', id => {
    expect(buildDemoInputs(demoById(id)!, DEFAULT_OPTIONS, scope)).toEqual({ scope, oprfDomain: DEMO_DOMAIN });
  });
  it('sends no OPRF domain for the email proof, which has no OPRF nullifier', () => {
    expect(buildDemoInputs(demoById('email')!, DEFAULT_OPTIONS, scope)).not.toHaveProperty('oprfDomain');
  });
  it('refuses a demo it has no inputs for, naming it', () => {
    const invented = { ...demoById('kyc')!, id: 'age' as DemoId };
    expect(() => buildDemoInputs(invented, DEFAULT_OPTIONS, scope)).toThrow("No inputs are defined for demo 'age'.");
  });
  it.each([
    ['country', { countries: '' }], ['country', { countries: 'USA' }], ['country', { countries: 'US,KR,' }],
    ['country', { countries: 'US,KR,JP,GB,DE,FR,IT,CA,AU,ES,NZ' }],
    ['email', { domain: 'person@example.com' }], ['email', { domain: 'https://example.com' }],
    ['email', { domain: '-bad.example' }], ['email', { provider: 'apple' as DemoOptions['provider'] }],
    ['passport', { minScore: '' }], ['passport', { minScore: '   ' }], ['passport', { minScore: '0' }], ['passport', { minScore: '0.00001' }],
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

describe.each(['kyc', 'country', 'passport'] as CardDemo[])('%s OPRF nullifier policy', id => {
  const oprf = () => { const layout = LAYOUT[id]; if (layout.kind !== 'oprf') throw new Error(`${id} has no OPRF layout`); return layout.oprf; };
  it('accepts the testnet key hash and the demo domain on Base Sepolia', () => {
    const { response, context } = fixture(id);
    expect(response.publicInputs![oprf().keyHash]).toBe(TESTNET_OPRF_KEY_HASH);
    expect(response.publicInputs![oprf().domain]).toBe(DEMO_DOMAIN_FIELD);
    expect(prepareDemoProof(response, context).publicInputs).toEqual(response.publicInputs);
  });
  it.each([['zero', field(0)], ['another key', '0x' + '11'.repeat(32)], ['the domain field', DEMO_DOMAIN_FIELD]])('refuses a proof under %s as OPRF key hash', (_, keyHash) => {
    const { response, context } = fixture(id); response.publicInputs![oprf().keyHash] = keyHash;
    expect(() => prepareDemoProof(response, context)).toThrow(/OPRF key hash/);
  });
  it('refuses a proof keyed by another domain', () => {
    const { response, context } = fixture(id); response.publicInputs![oprf().domain] = field(1);
    expect(() => prepareDemoProof(response, context)).toThrow(/OPRF domain/);
  });
  it('refuses the plain keccak256 scope a proof made before the OPRF nullifier published', () => {
    const { response, context } = fixture(id);
    response.publicInputs![oprf().scope] = '0x' + (BigInt(response.publicInputs![oprf().scope]) + BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')).toString(16);
    expect(() => prepareDemoProof(response, context)).toThrow(/field modulus|session/);
  });
  it.each([['the field modulus', '0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001'], ['a non-number', 'garbage']])('refuses a nullifier that is %s', (_, value) => {
    const { response, context } = fixture(id); response.publicInputs![oprf().nullifier] = value;
    expect(() => prepareDemoProof(response, context)).toThrow();
  });
});

describe('predicate substitution', () => {
  it.each([['kyc', KYC.MERKLE_ROOT_START, 'attester'], ['country', COUNTRY.MERKLE_ROOT_START, 'attester'], ['passport', PASSPORT.MERKLE_ROOT_START, 'issuer']] as [CardDemo, number, string][])('rejects a different signer root for %s', (id, at, name) => {
    const { response, context } = fixture(id); response.publicInputs![at] = field(0);
    expect(() => prepareDemoProof(response, context)).toThrow(name);
  });
  it('accepts an exclusion proof only for the matching exclusion request', () => {
    const { response, context } = fixture('country', { ...DEFAULT_OPTIONS, inclusion: false });
    expect(prepareDemoProof(response, context)).toBeDefined();
    expect(() => prepareDemoProof(response, { ...context, options: DEFAULT_OPTIONS })).toThrow('country policy');
  });
  it('checks every country and the list length', () => {
    const { response, context } = fixture('country'); response.publicInputs![COUNTRY.COUNTRY_LIST_START + 1] = field(65);
    expect(() => prepareDemoProof(response, context)).toThrow('different country list');
    response.publicInputs![COUNTRY.COUNTRY_LIST_LENGTH] = field(2);
    expect(() => prepareDemoProof(response, context)).toThrow('country policy');
  });
  it('matches both the domain and the provider', () => {
    const { response, context } = fixture('email');
    expect(() => prepareDemoProof(response, { ...context, options: { ...DEFAULT_OPTIONS, domain: 'another.com' } })).toThrow('domain and provider');
    expect(() => prepareDemoProof(response, { ...context, options: { ...DEFAULT_OPTIONS, provider: 'microsoft' } })).toThrow('domain and provider');
  });
  it('refuses a v1 (148-input) email proof: only the 214-input v2 circuit binds audience, nonce and time', () => {
    const { response, context } = fixture('email');
    expect(prepareDemoProof(response, context).publicInputs).toHaveLength(214);
    expect(() => prepareDemoProof({ ...response, publicInputs: response.publicInputs!.slice(0, 148) }, context)).toThrow('unexpected public-input format');
    expect(() => prepareDemoProof({ ...response, publicInputs: [...response.publicInputs!, field(0)] }, context)).toThrow('unexpected public-input format');
  });
  it('rejects a malformed domain length', () => {
    const { response, context } = fixture('email'); response.publicInputs![OIDC.DOMAIN_LEN] = field(65);
    expect(() => prepareDemoProof(response, context)).toThrow('invalid length');
  });
  it('rejects a field masquerading as a byte in the email scope', () => {
    const { response, context } = fixture('email'); response.publicInputs![OIDC.SCOPE_START] = field(256);
    expect(() => prepareDemoProof(response, context)).toThrow('invalid byte');
  });
});

describe('Human Passport score threshold, as typed', () => {
  it.each([['20', 20], [' 20.5 ', 20.5], ['0.0001', 0.0001], ['429496.7295', 429496.7295], ['007', 7], ['20\n', 20], ['\t15', 15]] as const)('accepts %j as %s points', (text, points) => {
    expect(parseMinScore(text)).toBe(points);
  });
  it.each([
    '', '   ', '\n', '0', '0.0', '0.0000', '-1', '+20', '20.12345', '429496.7296', '9999999', '1e3', '0x14', 'Infinity', 'NaN',
    'abc', '20,5', '20.', '.5', '2 0', '2\n0', '２０', '20점', '스물', '🙂', '<script>alert(1)</script>', "20' OR '1'='1", '%', '_', '\\', '9'.repeat(10_000),
  ])('refuses %j before any request is made', text => {
    expect(() => parseMinScore(text)).toThrow(/score threshold/);
  });
  it('keeps the threshold out of the request when it is refused', () => {
    expect(() => buildDemoInputs(demoById('passport')!, { ...DEFAULT_OPTIONS, minScore: '20.12345' }, scope)).toThrow(/four decimals/);
  });
});

describe('Human Passport response policy', () => {
  it('accepts a proof made for exactly the requested threshold', () => {
    const { response, context } = fixture('passport', { ...DEFAULT_OPTIONS, minScore: '20.5' });
    expect(prepareDemoProof(response, context).publicInputs).toHaveLength(135);
  });
  it.each([['19.9999'], ['20.0001'], ['0.0001'], ['2000']])('refuses a proof made for %s when 20 was asked', made => {
    const { response, context } = fixture('passport', { ...DEFAULT_OPTIONS, minScore: made });
    expect(() => prepareDemoProof(response, { ...context, options: DEFAULT_OPTIONS })).toThrow('score threshold');
  });
  it('refuses a zero threshold field, the cheapest one a prover could write', () => {
    const { response, context } = fixture('passport'); response.publicInputs![PASSPORT.MIN_SCORE] = field(0);
    expect(() => prepareDemoProof(response, context)).toThrow('score threshold');
  });
  it('is accepted on Base and Base Sepolia only, the chains the app verifies it on', () => {
    const { response, context } = fixture('passport');
    // Base's verifier predates the current circuit; core refuses it by name until it is redeployed.
    expect(() => prepareDemoProof({ ...response, chainId: 8453 }, context)).toThrow(/awaits a redeploy/);
    for (const chainId of [1, 10, 42161, 59144, 534352, 324, 11155111]) {
      expect(() => prepareDemoProof({ ...response, chainId }, context), String(chainId)).toThrow('configured verifier');
    }
  });
  it('refuses a signer package the circuit does not have', () => {
    const { response, context } = fixture('passport');
    expect(() => prepareDemoProof({ ...response, signerVariant: 'android' }, context)).toThrow(/no "android" signer variant/);
  });
});

describe('the package that made a proof picks its verifier', () => {
  it.each(['kyc', 'country', 'email'] as CardDemo[])('accepts an Android-signed %s proof against the Android verifier', id => {
    const demo = demoById(id)!;
    const response = cardResult(id, requestId, scope, DEFAULT_OPTIONS, 'android');
    const prepared = prepareDemoProof(response, { demo, requestId, scope, options: DEFAULT_OPTIONS });
    expect(prepared.signerVariant).toBe('android');
    expect(prepared.verifierAddress).toBe(variantVerifierAddress(demo.circuit, 84532, 'android'));
  });
  it('refuses an Android claim on a proof of the standard length, and the reverse', () => {
    const { response, context } = fixture('kyc');
    expect(() => prepareDemoProof({ ...response, signerVariant: 'android' }, context)).toThrow();
    const android = cardResult('kyc', requestId, scope, DEFAULT_OPTIONS, 'android');
    expect(() => prepareDemoProof({ ...android, signerVariant: undefined }, context)).toThrow();
  });
  it('refuses a standard proof that names the Android verifier', () => {
    const { response, context } = fixture('kyc');
    expect(() => prepareDemoProof({ ...response, verifierAddress: variantVerifierAddress(context.demo.circuit, 84532, 'android') }, context)).toThrow('configured verifier');
  });
});

describe('what a fresh verifier SDK is told about the request', () => {
  it('the threshold for passport, the list and direction for country, nothing for the rest', () => {
    expect(verificationConditions(demoById('passport')!, { ...DEFAULT_OPTIONS, minScore: '25' }, scope)).toEqual({ minScore: 25 });
    expect(verificationConditions(demoById('country')!, { ...DEFAULT_OPTIONS, countries: 'kp, ir', inclusion: false }, scope)).toEqual({ countryCondition: { countryList: ['KP', 'IR'], isIncluded: false } });
    for (const id of ['kyc', 'email', 'giwa', 'ssiat'] as DemoId[]) expect(verificationConditions(demoById(id)!, DEFAULT_OPTIONS, scope), id).toEqual({});
  });
});
