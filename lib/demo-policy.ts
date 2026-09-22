import {
  CIRCUIT_IDS, validateTypedAction, extractScopeFromPublicInputs, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  MDL_KR_PUBLIC_INPUT_LAYOUT as MDL, OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as OIDC,
  type CircuitInputs, type CircuitType, type ProofResponse, type RelayProofResult,
} from '@zkproofport-app/sdk';
import { concat, keccak256, toUtf8Bytes } from 'ethers';
import { type DemoDefinition, REGIONS } from './demo-catalog';
import { GIWA_CHAIN_ID, GIWA_VERIFIER, GIWA_PUBLIC_INPUT_COUNT, prepareGiwaMembershipProof } from './giwa-membership';

/**
 * The Arc actions offered as cards, plus the escape hatch.
 *
 * The named three mirror the mobile app's action screen. `custom` is what makes
 * the demo honest about the circuit: it hashes any EIP-712 structure without
 * reading it, so a grant of authority or an agreement in prose is as provable
 * as a deposit. This list lives here rather than in the SDK — the SDK's
 * `TypedAction` already accepts anything, and which three a UI offers is not
 * something two packages need to agree on.
 */
export const ARC_ACTIONS = [
  { name: 'Deposit', fields: [{ name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }] },
  { name: 'Withdraw', fields: [{ name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }] },
  { name: 'Transfer', fields: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }] },
] as const;

export type ArcActionChoice = (typeof ARC_ACTIONS)[number]['name'] | 'custom';

/** The EIP-712 types a field can have in the custom builder. */
export const ARC_FIELD_TYPES = ['address', 'uint256', 'string', 'bool', 'bytes32'] as const;
export type ArcFieldType = (typeof ARC_FIELD_TYPES)[number];
export type ArcCustomField = { name: string; type: ArcFieldType; value: string };

export type DemoOptions = {
  countries: string; inclusion: boolean; domain: string; provider: 'google' | 'microsoft'; age: string; region: string;
  /**
   * Arc: the ACTION, and only the action.
   *
   * The chain and the verifying contract are not choices — the verifier is on
   * Arc Testnet and nowhere else, so any other pair makes a proof nothing can
   * check. What varies is the structure being authorised.
   *
   * Picked by name from the SDK's list, with named fields, the way the mobile
   * app's action screen does it. `custom` is the last choice, for a structure
   * the list does not carry; a demo that opened with a JSON box asked a person
   * to write EIP-712 by hand to see a deposit.
   */
  arcAction: ArcActionChoice;
  /** Values for the picked action's named fields. */
  arcTo: string;
  arcAmount: string;
  arcNonce: string;
  /** Only read when `arcAction` is `custom`: the struct name and its fields. */
  arcCustomName: string;
  arcCustomFields: ArcCustomField[];
};
export const DEFAULT_OPTIONS: DemoOptions = {
  countries: 'US, KR, JP', inclusion: true, domain: 'zkproofport.com', provider: 'google', age: '19', region: REGIONS[0].value,
  arcAction: 'Deposit',
  arcTo: '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739',
  arcAmount: '1000000',
  arcNonce: '1',
  arcCustomName: 'GrantAuthority',
  arcCustomFields: [
    { name: 'agent', type: 'address', value: '0x0000000000000000000000000000000000000001' },
    { name: 'ceiling', type: 'uint256', value: '5000000' },
    { name: 'memo', type: 'string', value: 'quarterly rebalance only' },
  ],
};

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

/**
 * The one Arc deployment: its chain and its verifier contract.
 *
 * Read from DEMO_VERIFIERS rather than written again, and it throws instead of
 * picking one when the table does not hold exactly one -- a second row would
 * mean a choice nobody has made.
 */
/** One of the named actions, or an error saying which exist. */
function arcNamedAction(name: string) {
  const found = ARC_ACTIONS.find(action => action.name === name);
  if (!found) {
    throw new Error(`Unknown action '${name}'. Known: ${ARC_ACTIONS.map(a => a.name).join(', ')}.`);
  }
  return found;
}

/**
 * A field's value, checked against its declared type.
 *
 * The wallet renders these and the circuit hashes them without reading them,
 * so a value that does not match its type is signed and proved exactly like a
 * correct one — and only fails much later, at a contract that decodes it.
 */
function checkedFieldValue(name: string, type: ArcFieldType, raw: string): string | boolean {
  const value = raw.trim();
  switch (type) {
    case 'address':
      if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error(`${name} must be 0x followed by 40 hex characters.`);
      }
      return value;
    case 'uint256':
      if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be a whole number.`);
      return value;
    case 'bytes32':
      if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
        throw new Error(`${name} must be 0x followed by 64 hex characters.`);
      }
      return value;
    case 'bool':
      if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`);
      return value === 'true';
    case 'string':
      if (!value) throw new Error(`${name} must not be empty.`);
      return value;
  }
}

function arcDeployment(): [number, string] {
  const rows = Object.entries(DEMO_VERIFIERS[CIRCUIT_IDS.ARC_ELIGIBILITY] ?? {});
  if (rows.length !== 1) {
    throw new Error(
      `arc_eligibility should have exactly one deployment; DEMO_VERIFIERS has ${rows.length}.`,
    );
  }
  const [chain, contract] = rows[0];
  return [Number(chain), contract];
}

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
    case 'arc': {
      // Chain and contract come from the deployment table, never from input.
      const [chainId, verifyingContract] = arcDeployment();
      const namedValues = new Map<string, string>([
        ['to', options.arcTo], ['amount', options.arcAmount], ['nonce', options.arcNonce],
      ]);

      const fields =
        options.arcAction === 'custom'
          ? options.arcCustomFields
          : arcNamedAction(options.arcAction).fields.map(field => {
              const value = namedValues.get(field.name);
              if (value === undefined) throw new Error(`No input is configured for action field '${field.name}'.`);
              return {...field, value};
            });

      const primaryType =
        options.arcAction === 'custom' ? options.arcCustomName.trim() : options.arcAction;
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(primaryType)) {
        throw new Error('The action name must start with a letter and contain only letters, digits and underscores.');
      }
      if (!fields.length) throw new Error('An action needs at least one field.');

      const seen = new Set<string>();
      const message: Record<string, string | boolean> = {};
      for (const field of fields) {
        const name = field.name.trim();
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
          throw new Error(`Field name '${field.name}' must start with a letter and contain only letters, digits and underscores.`);
        }
        if (seen.has(name)) throw new Error(`Field '${name}' is listed twice.`);
        seen.add(name);
        message[name] = checkedFieldValue(name, field.type, field.value);
      }

      const action = {
        domain: { name: 'ZKProofport Demo Vault', version: '1', chainId, verifyingContract },
        types: { [primaryType]: fields.map(field => ({ name: field.name.trim(), type: field.type })) },
        primaryType,
        message,
      };
      // The SDK's own validator, so the demo and the mobile app cannot disagree
      // about what a usable action is.
      const problem = validateTypedAction(action);
      if (problem) throw new Error(problem);
      return { scope, action };
    }
    default: return { scope };
  }
}

const PUBLIC_COUNTS: Record<CircuitType, number> = {
  [CIRCUIT_IDS.GIWA_ATTESTATION]: GIWA_PUBLIC_INPUT_COUNT, [CIRCUIT_IDS.COINBASE_ATTESTATION]: 128,
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
  // Where the scope sits differs per circuit, so the SDK is asked rather than
  // guessed at here. A chain of `demo.id === …` used to end in the Korean
  // mobile ID offset, which meant every circuit it did not name — Arc among
  // them — had its scope read from byte 0 and every returned proof refused.
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
 * every chain nobody listed. Here that was Base: an Arc proof was labelled
 * "Awaiting proof" and its verifier link pointed at BaseScan, which is a link
 * to a contract that does not exist on that chain.
 */
const CHAINS: Readonly<Record<number, { name: string; explorer: string }>> = Object.freeze({
  8453: { name: 'Base', explorer: 'https://basescan.org' },
  84532: { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org' },
  91342: { name: 'GIWA Sepolia', explorer: 'https://sepolia-explorer.giwa.io' },
  5042002: { name: 'Arc Testnet', explorer: 'https://testnet.arcscan.app' },
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
