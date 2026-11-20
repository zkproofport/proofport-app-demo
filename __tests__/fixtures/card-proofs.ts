import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT as KYC, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  COINBASE_COUNTRY_PUBLIC_INPUT_COUNT, HUMAN_PASSPORT_ISSUER_ROOT, HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT as PASSPORT, HUMAN_PASSPORT_SCORER_IDS, OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as OIDC,
  evmProofByteLength, getCircuitPackage, humanPassportScoreUnits, type RelayProofResult, type SignerVariant,
} from '@zkproofport-app/sdk';
import { COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT, OIDC_PUBLIC_INPUT_COUNT, reduceOprfName } from '@zkproofport-app/core';
import { getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { DEMO_DOMAIN_FIELD, TESTNET_OPRF_KEY_HASH } from './giwa';
import { COINBASE_SIGNER_ROOT, DEFAULT_OPTIONS, parseMinScore, type DemoOptions } from '../../lib/demo-policy';
import { demoById, type DemoId } from '../../lib/demo-catalog';
import { variantVerifierAddress } from '../../lib/verifier-deployments';

/**
 * Public inputs shaped like a real proof for each card demo, written from the
 * SDK's layouts rather than typed-out offsets. They contain no valid proof:
 * they exercise the demo's own request policy, and must still fail the SDK's
 * cryptographic verification.
 */
export const field = (value: number | bigint) => `0x${value.toString(16).padStart(64, '0')}`;

export type CardDemo = 'kyc' | 'country' | 'email' | 'passport';

/**
 * Per demo: count, and where the scope sits. A wallet credential publishes its
 * scope as ONE field element beside the OPRF key hash, domain and nullifier
 * (`oprf`); OIDC lays its keccak256 out one byte per input from `bytesAt`.
 * Keyed, so a demo with no row is an error.
 */
export type CardLayout =
  | { count: number; kind: 'oprf'; oprf: { keyHash: number; domain: number; scope: number; nullifier: number } }
  | { count: number; kind: 'bytes'; bytesAt: number };
const oprf = (l: { OPRF_KEY_HASH: number; OPRF_DOMAIN: number; SCOPE: number; NULLIFIER: number }) =>
  ({ keyHash: l.OPRF_KEY_HASH, domain: l.OPRF_DOMAIN, scope: l.SCOPE, nullifier: l.NULLIFIER });
export const LAYOUT: Record<CardDemo, CardLayout> = {
  kyc: { count: COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT, kind: 'oprf', oprf: oprf(KYC) },
  country: { count: COINBASE_COUNTRY_PUBLIC_INPUT_COUNT, kind: 'oprf', oprf: oprf(COUNTRY) },
  email: { count: OIDC_PUBLIC_INPUT_COUNT, kind: 'bytes', bytesAt: OIDC.SCOPE_START },
  passport: { count: HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_COUNT, kind: 'oprf', oprf: oprf(PASSPORT) },
};
/** A nullifier is a field element, below the BN254 modulus. */
export const CARD_NULLIFIER = '0x' + '0c'.repeat(32);

/**
 * A proof of the byte length the circuit's package produces. For a circuit with
 * several packages the SDK tells them apart by length, so a short placeholder
 * is refused before any policy runs.
 */
export function proofHex(circuit: string, variant: SignerVariant = 'standard'): string {
  const log = getCircuitPackage(circuit, variant).logCircuitSize;
  const bytes = log === undefined ? 4 : evmProofByteLength(log);
  return '0x' + 'ab'.repeat(bytes);
}

export function cardInputs(id: CardDemo, scope: string, options: DemoOptions = DEFAULT_OPTIONS): string[] {
  const layout = LAYOUT[id];
  if (!layout) throw new Error(`No public-input layout for '${id}'. Known: ${Object.keys(LAYOUT).join(', ')}.`);
  const values = Array.from({ length: layout.count }, () => field(0));
  const put = (start: number, bytes: Uint8Array) => bytes.forEach((value, index) => { values[start + index] = field(value); });
  if (layout.kind === 'oprf') {
    values[layout.oprf.keyHash] = TESTNET_OPRF_KEY_HASH;
    values[layout.oprf.domain] = DEMO_DOMAIN_FIELD;
    values[layout.oprf.scope] = reduceOprfName(scope);
    values[layout.oprf.nullifier] = CARD_NULLIFIER;
  } else {
    put(layout.bytesAt, getBytes(keccak256(toUtf8Bytes(scope))));
  }
  if (id === 'kyc') put(KYC.MERKLE_ROOT_START, getBytes(COINBASE_SIGNER_ROOT));
  if (id === 'country') {
    put(COUNTRY.MERKLE_ROOT_START, getBytes(COINBASE_SIGNER_ROOT));
    const countries = [...new Set(options.countries.split(',').map(value => value.trim().toUpperCase()))];
    put(COUNTRY.COUNTRY_LIST_START, toUtf8Bytes(countries.join('')));
    values[COUNTRY.COUNTRY_LIST_LENGTH] = field(countries.length);
    values[COUNTRY.IS_INCLUDED] = field(options.inclusion ? 1 : 0);
  }
  if (id === 'email') {
    const domain = toUtf8Bytes(options.domain);
    put(OIDC.DOMAIN_STORAGE_START, domain); values[OIDC.DOMAIN_LEN] = field(domain.length);
    values[OIDC.PROVIDER] = field(options.provider === 'microsoft' ? 1 : 0);
  }
  if (id === 'passport') {
    put(PASSPORT.MERKLE_ROOT_START, getBytes(HUMAN_PASSPORT_ISSUER_ROOT));
    values[PASSPORT.MIN_SCORE] = field(humanPassportScoreUnits(parseMinScore(options.minScore)));
    values[PASSPORT.SCORER_ID] = field(HUMAN_PASSPORT_SCORER_IDS[0]);
    values[PASSPORT.NOW] = field(Math.floor(Date.now() / 1000));
  }
  return values;
}

/** A completed relay result for one card demo, as the app sends it on Base Sepolia. */
export function cardResult(id: CardDemo, requestId: string, scope: string, options: DemoOptions = DEFAULT_OPTIONS, variant: SignerVariant = 'standard'): RelayProofResult {
  const demo = demoById(id as DemoId);
  if (!demo) throw new Error(`No demo '${id}'.`);
  return {
    requestId, circuit: demo.circuit, status: 'completed', proof: proofHex(demo.circuit, variant), publicInputs: cardInputs(id, scope, options),
    chainId: 84532, verifierAddress: variantVerifierAddress(demo.circuit, 84532, variant),
    ...(variant !== 'standard' && { signerVariant: variant }),
  };
}
