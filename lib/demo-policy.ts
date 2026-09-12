import {
  CIRCUIT_IDS, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  MDL_KR_PUBLIC_INPUT_LAYOUT as MDL, OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as OIDC,
  type CircuitInputs, type CircuitType, type ProofResponse, type RelayProofResult,
} from '@zkproofport-app/sdk';
import { concat, keccak256, toUtf8Bytes } from 'ethers';
import { type DemoDefinition, REGIONS } from './demo-catalog';
import { GIWA_CHAIN_ID, GIWA_VERIFIER, prepareGiwaMembershipProof } from './giwa-membership';

export type DemoOptions = { countries: string; inclusion: boolean; domain: string; provider: 'google' | 'microsoft'; age: string; region: string };
export const DEFAULT_OPTIONS: DemoOptions = { countries: 'US, KR, JP', inclusion: true, domain: 'zkproofport.com', provider: 'google', age: '19', region: REGIONS[0].value };

// Allowlisted deployments from the mobile app's contracts.ts. Responses can
// select an existing deployment, never supply an arbitrary verifier contract.
export const DEMO_VERIFIERS: Record<CircuitType, Record<number, string>> = {
  [CIRCUIT_IDS.GIWA_ATTESTATION]: { [GIWA_CHAIN_ID]: GIWA_VERIFIER },
  [CIRCUIT_IDS.COINBASE_ATTESTATION]: { 8453: '0xf7ded73e7a7fc8fb030c35c5a88d40abe6865382', 84532: '0x0036b61dbfab8f3cfeef77dd5d45f7efbfe2035c' },
  [CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION]: { 8453: '0xf3d5a09d2c85b28c52ef2905c1be3a852b609d0c', 84532: '0xdee363585926c3c28327efd1edd01cf4559738cf' },
  [CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: { 8453: '0x9677ba46ad226ce8b3c4517d9c0143e4d458beae', 84532: '0x27afdea349f247cf698f97fdfab59e1bf8bd0550' },
  [CIRCUIT_IDS.MDL_KR_OWNERSHIP]: { 84532: '0x7602d09d24e6e16eff5ab981646872886376763e' },
  [CIRCUIT_IDS.MDL_KR_AGE]: { 84532: '0xcff90ff8ceadc98f625300dc976ed85a3aa943ba' },
  [CIRCUIT_IDS.MDL_KR_REGION]: { 84532: '0x435f0448f02f5df9659d460181116bcaf37e518e' },
  // Arc Testnet, and nowhere else. Circle has published no mainnet chain id,
  // so there is no second row to add.
  [CIRCUIT_IDS.ARC_ELIGIBILITY]: { 5042002: '0xcbc8e63ff92659e8b44cff117d33005bb669a018' },
};

const signerLeaves = [
  '0x952f32128AF084422539C4Ff96df5C525322E564', '0x8844591D47F17bcA6F5dF8f6B64F4a739F1C0080',
  '0x88fe64ea2e121f49bb77abea6c0a45e93638c3c5', '0x44ace9abb148e8412ac4492e9a1ae6bd88226803',
].map(address => keccak256(address));
export const COINBASE_SIGNER_ROOT = keccak256(concat([
  keccak256(concat(signerLeaves.slice(0, 2))), keccak256(concat(signerLeaves.slice(2, 4))),
]));

export function buildDemoInputs(demo: DemoDefinition, options: DemoOptions, scope: string): CircuitInputs {
  switch (demo.id) {
    case 'country': {
      const countryList = [...new Set(options.countries.split(',').map(code => code.trim().toUpperCase()))];
      if (!countryList.length || countryList.length > 10 || countryList.some(code => !/^[A-Z]{2}$/.test(code))) {
        throw new Error('Enter 1 to 10 two-letter country codes, separated by commas.');
      }
      return { scope, countryList, isIncluded: options.inclusion };
    }
    case 'email': {
      const domain = options.domain.trim().toLowerCase();
      if (domain.length > 64 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
        throw new Error('Enter a domain such as company.com, without an email address or https://.');
      }
      if (!['google', 'microsoft'].includes(options.provider)) throw new Error('Select a supported sign-in provider.');
      return { scope, domain, provider: options.provider };
    }
    case 'age': {
      const ageThreshold = Number(options.age);
      if (!Number.isInteger(ageThreshold) || ageThreshold < 1 || ageThreshold > 150) throw new Error('Enter a whole-number age between 1 and 150.');
      return { scope, ageThreshold };
    }
    case 'region':
      if (!REGIONS.some(region => region.value === options.region)) throw new Error('Select a region from the list.');
      return { scope, targetRegion: options.region };
    case 'ownership': return { scope, discloseFlags: 0 };
    default: return { scope };
  }
}

const PUBLIC_COUNTS: Record<CircuitType, number> = {
  [CIRCUIT_IDS.GIWA_ATTESTATION]: 128, [CIRCUIT_IDS.COINBASE_ATTESTATION]: 128,
  [CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION]: 150, [CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: 148,
  [CIRCUIT_IDS.MDL_KR_OWNERSHIP]: 97, [CIRCUIT_IDS.MDL_KR_AGE]: 66, [CIRCUIT_IDS.MDL_KR_REGION]: 96,
  // Six 32-byte public inputs: signal_hash, domain_separator, action_hash,
  // signer_list_merkle_root, scope, nullifier. Read off the compiled ABI in
  // arc-eligibility/target, not counted.
  [CIRCUIT_IDS.ARC_ELIGIBILITY]: 192,
};

function bytes(inputs: string[], start: number, length = 32): Uint8Array {
  return Uint8Array.from(inputs.slice(start, start + length).map(input => {
    const value = BigInt(input);
    if (value > BigInt(255)) throw new Error('The proof contains an invalid byte value.');
    return Number(value);
  }));
}

function equalHash(inputs: string[], start: number, expected: string, name: string) {
  const actual = '0x' + Array.from(bytes(inputs, start), byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected.toLowerCase()) throw new Error(`This proof does not match the requested ${name}.`);
}

export type DemoRequestContext = { demo: DemoDefinition; requestId: string; scope: string; options: DemoOptions; year: number };

/** Check the request and public predicate, before cryptographic verification. */
export function prepareDemoProof(result: RelayProofResult, context: DemoRequestContext): ProofResponse {
  const { demo, requestId, scope, options, year } = context;
  if (demo.id === 'giwa') return prepareGiwaMembershipProof(result, requestId, scope);
  if (result.requestId !== requestId || result.circuit !== demo.circuit) throw new Error('This proof belongs to a different demo request.');
  if (result.status !== 'completed' || !result.proof || !/^0x(?:[0-9a-f]{2})+$/i.test(result.proof)) throw new Error(result.error || 'A completed proof is required.');
  const verifier = result.chainId === undefined ? undefined : DEMO_VERIFIERS[demo.circuit][result.chainId];
  if (!verifier || result.verifierAddress?.toLowerCase() !== verifier) throw new Error('The proof does not use a configured verifier for this circuit.');
  const inputs = result.publicInputs;
  if (!inputs || inputs.length !== PUBLIC_COUNTS[demo.circuit] || inputs.some(value => !/^0x[0-9a-f]{1,64}$/i.test(value))) {
    throw new Error('The proof has an unexpected public-input format.');
  }
  const requested = buildDemoInputs(demo, options, scope);
  const scopeStart = demo.id === 'country' ? COUNTRY.SCOPE_START : demo.id === 'email' ? OIDC.SCOPE_START : demo.id === 'kyc' ? 64 : MDL.SCOPE_START;
  equalHash(inputs, scopeStart, keccak256(toUtf8Bytes(scope)), 'session');
  if (demo.id === 'kyc' || demo.id === 'country') equalHash(inputs, 32, COINBASE_SIGNER_ROOT, 'attester');
  if (demo.id === 'country' && 'countryList' in requested) {
    const length = Number(BigInt(inputs[COUNTRY.COUNTRY_LIST_LENGTH]));
    if (length !== requested.countryList.length || BigInt(inputs[COUNTRY.IS_INCLUDED]) !== BigInt(requested.isIncluded ? 1 : 0)) throw new Error('The proof does not match the selected country policy.');
    const countryBytes = bytes(inputs, COUNTRY.COUNTRY_LIST_START, 20);
    const expected = new Uint8Array(20);
    expected.set(toUtf8Bytes(requested.countryList.join('')));
    if (countryBytes.some((value, index) => value !== expected[index])) throw new Error('The proof uses a different country list.');
  }
  if (demo.id === 'email' && 'domain' in requested) {
    const length = Number(BigInt(inputs[OIDC.DOMAIN_LEN]));
    if (length < 1 || length > 64) throw new Error('The domain proof has an invalid length.');
    const domain = new TextDecoder().decode(bytes(inputs, OIDC.DOMAIN_STORAGE_START, length));
    if (domain !== requested.domain || BigInt(inputs[OIDC.PROVIDER]) !== BigInt(options.provider === 'microsoft' ? 1 : 0)) throw new Error('The proof does not match the selected email domain and provider.');
  }
  if (demo.id === 'ownership' && BigInt(inputs[MDL.OWNERSHIP_DISCLOSE_FLAGS]) !== BigInt(0)) throw new Error('This reader pass requires anonymous disclosure settings.');
  if (demo.id === 'age' && (BigInt(inputs[MDL.AGE_THRESHOLD]) !== BigInt(options.age) || BigInt(inputs[MDL.AGE_CURRENT_YEAR]) !== BigInt(year))) throw new Error('The proof does not match the requested age threshold and year.');
  if (demo.id === 'region') {
    const paddedRegion = new Uint8Array(64);
    paddedRegion.set(toUtf8Bytes(options.region));
    equalHash(inputs, MDL.REGION_CODE_START, keccak256(paddedRegion), 'region');
  }
  return { requestId, circuit: demo.circuit, status: 'completed', proof: result.proof, publicInputs: inputs, chainId: result.chainId, verifierAddress: verifier };
}

export function networkName(chainId?: number) {
  return chainId === 91342 ? 'GIWA Sepolia' : chainId === 84532 ? 'Base Sepolia' : chainId === 8453 ? 'Base' : 'Awaiting proof';
}

export function verifierLink(proof: ProofResponse): string {
  const origin = proof.chainId === 91342 ? 'https://sepolia-explorer.giwa.io' : proof.chainId === 84532 ? 'https://sepolia.basescan.org' : 'https://basescan.org';
  return `${origin}/address/${proof.verifierAddress}`;
}
