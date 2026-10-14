import {
  CIRCUIT_IDS, extractNullifierFromPublicInputs, extractScopeFromPublicInputs, validateTypedAction,
  type RelayProofResult, type TypedAction,
} from '@zkproofport-app/sdk';
import { AbiCoder, Interface, formatUnits, isAddress, keccak256, toBeHex, toUtf8Bytes, TypedDataEncoder, ZeroAddress, ZeroHash } from 'ethers';
import { GIWA_CHAIN_ID } from './giwa-membership';

/**
 * Ssiat (씨앗, "seed"): a fictional seed drop for GIWA Sepolia Playground faucet
 * participants. Contract source: contracts/src/SsiatDrop.sol.
 */

/**
 * The deployed SsiatDrop on GIWA Sepolia (2026-10-14, see contracts/README.md).
 * `ssiatDropAddress()` refuses an empty or malformed value, so the tab can never
 * read from or send to a placeholder.
 */
export const SSIAT_DROP_ADDRESS: string = '0x3e10c391d5068DCc216dfA3A7ae2e27830204eBd';

/** `dojang_playground` verifier: circuits/deployments/91342/DojangPlayground.json. */
export const SSIAT_VERIFIER = '0x2d01c2fe3445b7dde60118f956bb14e84fd64724';
export const SSIAT_CIRCUIT = CIRCUIT_IDS.DOJANG_PLAYGROUND;
export const SSIAT_PUBLIC_INPUT_COUNT = 160;
export const SSIAT_TOKEN_DECIMALS = 18;
export const SSIAT_SCOPE_PATTERN = /^ssiat-drop:v1:[0-9a-f]{64}$/;
/** The Playground faucet whose payAndIssueEAS() call the circuit requires. */
export const PLAYGROUND_FAUCET = '0x63CCe2b569A7bC35895ee24306c1512fefc06121';

/**
 * Where the action fields sit in the dojang_playground public inputs. Scope and
 * nullifier are read through the SDK, which keys their offsets per circuit.
 */
const ACTION_FIELDS = { signal: 0, domain: 32, action: 64 } as const;

export const SSIAT_DROP_ABI = [
  'function token() view returns (address)',
  'function CLAIM_AMOUNT() view returns (uint256)',
  'function remaining() view returns (uint256)',
  'function totalClaims() view returns (uint256)',
  'function claimScope() view returns (string)',
  'function domainSeparator() view returns (bytes32)',
  'function claimActionHash(address) view returns (bytes32)',
  'function claimed(bytes32) view returns (bool)',
  'function verifyClaim(address,bytes,bytes32[]) view returns (bool)',
  'function claim(address,bytes,bytes32[])',
  'error ZeroAddress()', 'error ProofRequired()', 'error InvalidPublicInputCount()', 'error InvalidPublicInputByte(uint256)',
  'error IdentityProofNotAllowed()', 'error WrongClaimDomain()', 'error WrongClaimAction()', 'error WrongClaimScope()',
  'error AlreadyClaimed(bytes32)', 'error DropExhausted()', 'error InvalidProof()', 'error TokenTransferFailed()', 'error Reentrancy()',
];
const dropInterface = new Interface(SSIAT_DROP_ABI);

/** The configured drop, or an error saying it has not been deployed. Never a stand-in address. */
export function ssiatDropAddress(configured: string = SSIAT_DROP_ADDRESS): string {
  if (!configured) {
    throw new Error('The Ssiat drop contract is not deployed yet. Set SSIAT_DROP_ADDRESS in lib/ssiat-drop.ts after broadcasting contracts/script/DeploySsiatDrop.s.sol.');
  }
  if (!isAddress(configured) || configured.toLowerCase() === ZeroAddress) {
    throw new Error(`SSIAT_DROP_ADDRESS '${configured}' is not a usable contract address.`);
  }
  return configured;
}

function requireAddress(value: string, what: string) {
  if (typeof value !== 'string' || !isAddress(value) || value.toLowerCase() === ZeroAddress) throw new Error(`Invalid ${what} address.`);
}

/** Exactly the action SsiatDrop.claimActionHash checks: Claim(recipient) under the Ssiat v1 domain. */
export function buildSsiatClaimAction(recipient: string, dropAddress: string): TypedAction {
  requireAddress(recipient, 'recipient');
  requireAddress(dropAddress, 'drop contract');
  return {
    domain: { name: 'Ssiat', version: '1', chainId: GIWA_CHAIN_ID, verifyingContract: dropAddress },
    primaryType: 'Claim',
    types: { Claim: [{ name: 'recipient', type: 'address' }] },
    message: { recipient },
  };
}

/** SsiatDrop.claimScope() computed off-chain, to check the contract the page talks to is the one it expects. */
export function expectedSsiatScope(dropAddress: string, chainId: number = GIWA_CHAIN_ID): string {
  requireAddress(dropAddress, 'drop contract');
  const seed = keccak256(AbiCoder.defaultAbiCoder().encode(['uint256', 'address'], [chainId, dropAddress]));
  return `ssiat-drop:v1:${seed.slice(2)}`;
}

/** The app hashes the scope string exactly like this (proofport-app computeScope). */
export const ssiatScopeHash = (scope: string) => keccak256(toUtf8Bytes(scope));

function field(inputs: string[], start: number): string {
  return '0x' + Array.from({ length: 32 }, (_, index) => BigInt(inputs[start + index]).toString(16).padStart(2, '0')).join('');
}

export type SsiatClaimProof = { requestId: string; proof: string; publicInputs: string[]; nullifier: string; scope: string; recipient: string };

/**
 * Check a returned proof against the claim this page asked for, before any
 * contract call. Every field the contract checks is checked here too, so a
 * mismatch is reported in words instead of as a revert.
 */
export function prepareSsiatClaimProof(result: RelayProofResult, requestId: string, scope: string, action: TypedAction): SsiatClaimProof {
  if (result.requestId !== requestId) throw new Error('This proof belongs to a different request. Please try again.');
  if (result.status !== 'completed' || typeof result.proof !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(result.proof)) {
    throw new Error('No completed proof was received. Please try again.');
  }
  if (result.circuit !== SSIAT_CIRCUIT) throw new Error(`A ${SSIAT_CIRCUIT} proof is required; this one is '${String(result.circuit)}'.`);
  if (result.chainId !== GIWA_CHAIN_ID || result.verifierAddress?.toLowerCase() !== SSIAT_VERIFIER) {
    throw new Error('This proof does not use the GIWA Sepolia Dojang Playground verifier.');
  }
  const inputs = result.publicInputs;
  if (!Array.isArray(inputs) || inputs.length !== SSIAT_PUBLIC_INPUT_COUNT) throw new Error('The proof has an unexpected public-input format.');
  inputs.forEach((value, index) => {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{1,64}$/i.test(value)) throw new Error('Malformed public input. Please create a new proof.');
    // The SDK reads a value above 255 as zero, so a malformed byte is refused before it is asked.
    if (BigInt(value) > BigInt(255)) throw new Error(`Public input ${index} is not a byte. Please create a new proof.`);
  });
  const problem = validateTypedAction(action);
  if (problem) throw new Error(`Invalid claim action: ${problem}`);
  if (field(inputs, ACTION_FIELDS.signal) !== ZeroHash) throw new Error('A claim proof must bind the claim action, not a plain signal.');
  if (field(inputs, ACTION_FIELDS.domain) !== TypedDataEncoder.hashDomain(action.domain)) throw new Error('This proof authorizes an action for a different app or contract.');
  if (field(inputs, ACTION_FIELDS.action) !== TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message)) {
    throw new Error('This proof authorizes a claim for a different recipient.');
  }
  if (extractScopeFromPublicInputs(inputs, SSIAT_CIRCUIT)?.toLowerCase() !== ssiatScopeHash(scope)) throw new Error('This proof was created for a different drop.');
  const nullifier = extractNullifierFromPublicInputs(inputs, SSIAT_CIRCUIT)?.toLowerCase();
  if (!nullifier || !/^0x[0-9a-f]{64}$/.test(nullifier)) throw new Error('The proof carries no nullifier.');
  return {
    requestId, proof: result.proof, publicInputs: inputs.map(value => toBeHex(BigInt(value), 32)), nullifier, scope,
    recipient: String(action.message.recipient),
  };
}

/** Errors that mean the proof itself must be replaced. */
export const SSIAT_PROOF_ERRORS = ['IdentityProofNotAllowed', 'WrongClaimDomain', 'WrongClaimAction', 'WrongClaimScope', 'InvalidProof', 'InvalidPublicInputCount', 'InvalidPublicInputByte', 'ProofRequired'];

export function ssiatErrorName(cause: unknown): string | undefined {
  const error = cause as { data?: string; info?: { error?: { data?: string | { data?: string } } } };
  const nested = error?.info?.error?.data;
  const data = error?.data || (typeof nested === 'string' ? nested : nested?.data);
  try { return typeof data === 'string' ? dropInterface.parseError(data)?.name : undefined; } catch { return undefined; }
}

const ERROR_MESSAGES: Record<string, string> = {
  AlreadyClaimed: 'This faucet wallet has already claimed its seeds.',
  DropExhausted: 'The drop is empty: every seed has been claimed.',
  WrongClaimAction: 'This proof names a different recipient. Generate a new proof for the connected wallet.',
  WrongClaimDomain: 'This proof was made for a different drop contract. Generate a new proof.',
  WrongClaimScope: 'This proof was made for a different drop. Generate a new proof.',
  IdentityProofNotAllowed: 'A claim needs a proof that signs the claim action. Generate a new proof.',
  InvalidProof: 'The proof did not pass the GIWA verifier. Generate a new proof.',
  InvalidPublicInputCount: 'The proof has the wrong number of public inputs. Generate a new proof.',
  InvalidPublicInputByte: 'The proof has a malformed public input. Generate a new proof.',
  ProofRequired: 'A proof is required to claim.',
  ZeroAddress: 'A recipient address is required.',
  TokenTransferFailed: 'The SEED transfer failed. Nothing was claimed.',
  Reentrancy: 'The claim was refused. Try again.',
};

export function ssiatErrorMessage(cause: unknown): string {
  const error = cause as { code?: string | number; shortMessage?: string; message?: string };
  if (error?.code === 'ACTION_REJECTED' || error?.code === 4001) return 'The wallet request was declined. You can try again.';
  const name = ssiatErrorName(cause);
  if (name) {
    const message = ERROR_MESSAGES[name];
    if (!message) throw new Error(`No message for SsiatDrop error '${name}'. Known: ${Object.keys(ERROR_MESSAGES).join(', ')}.`);
    return message;
  }
  return error?.shortMessage || error?.message || 'The request could not finish. Please try again.';
}

export function displaySeed(value: bigint | null): string {
  if (value === null) return '—';
  const [whole, fraction] = formatUnits(value, SSIAT_TOKEN_DECIMALS).split('.');
  return BigInt(whole).toLocaleString('en-US') + (fraction && fraction !== '0' ? `.${fraction}` : '');
}
