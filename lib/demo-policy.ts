import {
  CIRCUIT_IDS, extractScopeFromPublicInputs, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  MDL_KR_PUBLIC_INPUT_LAYOUT as MDL, OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as OIDC,
  type CircuitInputs, type ProofResponse, type RelayProofResult,
} from '@zkproofport-app/sdk';
import { COINBASE_SIGNER_SET } from '@zkproofport-app/core';
import { keccak256, toUtf8Bytes } from 'ethers';
import { type DemoCircuit, type DemoDefinition, REGIONS } from './demo-catalog';
import { GIWA_CHAIN_ID, GIWA_PUBLIC_INPUT_COUNT, prepareGiwaMembershipProof } from './giwa-membership';
import { SSIAT_PUBLIC_INPUT_COUNT } from './ssiat-drop';
import { VERIFIER_DEPLOYMENTS, verifierAddress } from './verifier-deployments';

export type DemoOptions = {
  countries: string; inclusion: boolean; domain: string; provider: 'google' | 'microsoft'; age: string; region: string;
};
export const DEFAULT_OPTIONS: DemoOptions = {
  countries: 'US, KR, JP', inclusion: true, domain: 'zkproofport.com', provider: 'google', age: '19', region: REGIONS[0].value,
};

// The allowlisted (circuit, chain) pairs, each resolved to core's pinned
// verifier. Responses can select an allowlisted deployment, never supply an
// arbitrary verifier contract.
export const DEMO_VERIFIERS: Record<DemoCircuit, Record<number, string>> = Object.fromEntries(
  Object.entries(VERIFIER_DEPLOYMENTS).map(([circuit, byChain]) => [
    circuit, Object.fromEntries(Object.keys(byChain).map(chain => [chain, verifierAddress(circuit, Number(chain))])),
  ]),
) as Record<DemoCircuit, Record<number, string>>;

/**
 * The Coinbase signer-list root a KYC or Country proof must carry. Taken from
 * core, which derives it from the provers' own signer lists and which the SDK's
 * verify functions also check; the demo used to rebuild the tree by hand here.
 */
export const COINBASE_SIGNER_ROOT = COINBASE_SIGNER_SET.root;

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
    // These requests carry only the scope. The Gotgan deposit flow builds its
    // action-bound request in lib/useGiwaVault.ts, and the Ssiat claim builds
    // its Claim(recipient) request in lib/useSsiatDrop.ts, not here.
    case 'kyc': case 'giwa': case 'ssiat': return { scope };
    default: {
      const unknown: never = demo.id;
      throw new Error(`No inputs are defined for demo '${unknown}'.`);
    }
  }
}

const PUBLIC_COUNTS: Record<DemoCircuit, number> = {
  [CIRCUIT_IDS.GIWA_ATTESTATION]: GIWA_PUBLIC_INPUT_COUNT, [CIRCUIT_IDS.DOJANG_PLAYGROUND]: SSIAT_PUBLIC_INPUT_COUNT,
  [CIRCUIT_IDS.COINBASE_ATTESTATION]: 128,
  [CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION]: 150, [CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: 148,
  [CIRCUIT_IDS.MDL_KR_OWNERSHIP]: 97, [CIRCUIT_IDS.MDL_KR_AGE]: 66, [CIRCUIT_IDS.MDL_KR_REGION]: 96,
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
  // A claim proof is only meaningful with its Claim(recipient) action, which this
  // generic path does not know. prepareSsiatClaimProof in lib/ssiat-drop.ts checks it.
  if (demo.id === 'ssiat') throw new Error('Ssiat claim proofs are checked by prepareSsiatClaimProof, with the claim action.');
  if (result.requestId !== requestId || result.circuit !== demo.circuit) throw new Error('This proof belongs to a different demo request.');
  if (result.status !== 'completed' || !result.proof || !/^0x(?:[0-9a-f]{2})+$/i.test(result.proof)) throw new Error(result.error || 'A completed proof is required.');
  const verifier = result.chainId === undefined ? undefined : DEMO_VERIFIERS[demo.circuit][result.chainId];
  if (!verifier || result.verifierAddress?.toLowerCase() !== verifier) throw new Error('The proof does not use a configured verifier for this circuit.');
  const inputs = result.publicInputs;
  if (!inputs || inputs.length !== PUBLIC_COUNTS[demo.circuit] || inputs.some(value => !/^0x[0-9a-f]{1,64}$/i.test(value))) {
    throw new Error('The proof has an unexpected public-input format.');
  }
  const requested = buildDemoInputs(demo, options, scope);
  // Where the scope sits differs per circuit, so the SDK is asked rather than
  // guessed at here. A chain of `demo.id === …` used to end in the Korean
  // mobile ID offset, which meant every circuit it did not name had its scope
  // read from byte 0 and every returned proof refused.
  const provenScope = extractScopeFromPublicInputs(inputs, demo.circuit);
  if (!provenScope) throw new Error('The proof carries no scope for this circuit.');
  if (provenScope.toLowerCase() !== keccak256(toUtf8Bytes(scope))) {
    // The scope is a hash decomposed into bytes, and the SDK quietly reads a
    // value above 255 as zero — so a malformed input reaches here looking like
    // an ordinary mismatch. Ask the SDK again with those values changed: if the
    // scope it returns moves, the bad value is inside the scope and this is not
    // a proof at all. Not every wide value is malformed — an age threshold and
    // a year are wider than a byte on purpose — which is why the question is
    // asked about the scope's own bytes and not about the array.
    const repaired = inputs.map(value => (BigInt(value) > BigInt(255) ? '0x01' : value));
    if (extractScopeFromPublicInputs(repaired, demo.circuit) !== provenScope) {
      throw new Error('The proof contains an invalid byte value.');
    }
    throw new Error('This proof does not match the requested session.');
  }
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

/**
 * The chains a demo proof can come back from: what to call each, and where to
 * look it up.
 *
 * Written as a table rather than a chain of `chainId === …`, because such a
 * chain has to end somewhere and whatever it ends on becomes the answer for
 * every chain nobody listed. Here that was Base: a proof from another chain
 * was labelled "Awaiting proof" and its verifier link pointed at BaseScan,
 * which is a link to a contract that does not exist on that chain.
 */
const CHAINS: Readonly<Record<number, { name: string; explorer: string }>> = Object.freeze({
  8453: { name: 'Base', explorer: 'https://basescan.org' },
  84532: { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org' },
  91342: { name: 'GIWA Sepolia', explorer: 'https://sepolia-explorer.giwa.io' },
});

/** The chain's name. No proof yet is its own answer; an unlisted chain is not. */
export function networkName(chainId?: number) {
  if (chainId === undefined) return 'Awaiting proof';
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Chain ${chainId} is not one this demo knows. Known: ${Object.keys(CHAINS).join(', ')}.`);
  return chain.name;
}

export function verifierLink(proof: ProofResponse): string {
  if (proof.chainId === undefined) throw new Error('The proof names no chain, so its verifier cannot be looked up.');
  const chain = CHAINS[proof.chainId];
  if (!chain) throw new Error(`Chain ${proof.chainId} is not one this demo knows. Known: ${Object.keys(CHAINS).join(', ')}.`);
  return `${chain.explorer}/address/${proof.verifierAddress}`;
}
