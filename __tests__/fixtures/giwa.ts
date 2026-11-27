import { CIRCUIT_IDS, evmProofByteLength, getCircuitPackage, type RelayProofResult, type SignerVariant, type TypedAction } from '@zkproofport-app/sdk';
import { reduceOprfName } from '@zkproofport-app/core';
import { keccak256, TypedDataEncoder } from 'ethers';

/**
 * The giwa_attestation v2 verifiers on GIWA Sepolia, one per signer package,
 * written out from circuits/deployments/91342/GiwaAttestationV2*.json rather
 * than read from the code under test.
 */
export const GIWA_TEST_VERIFIERS: Record<SignerVariant, string> = {
  standard: '0x55e7b9d9f2e9ac0080b668514ee01f15b686bfce',
  android: '0x428074597be3d784535e40f9b1cdfe048af57f03',
  android_factory: '0x465fab030d82241bd95268704537a782b8109807',
};
export const GIWA_TEST_VERIFIER = GIWA_TEST_VERIFIERS.standard;
/** The previous (132-input, bb 6.0.0) GIWA verifier, retired with the v2 circuits. */
export const GIWA_RETIRED_VERIFIER = '0xa272056866453f0182426a29b9ca6382d6c6a060';
/** Written out, not read from the code under test: core's testnet OPRF key hash. */
export const TESTNET_OPRF_KEY_HASH = '0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1';
export const DEMO_DOMAIN = 'demo.zkproofport.app';
/** reduceOprfName('demo.zkproofport.app'), written out; the plain keccak256 is above the field modulus. */
export const DEMO_DOMAIN_FIELD = '0x0fd195923d45a11d40ac6c6d66108ede0763262945cd8c62a90491a5e3c13a32';
/** A nullifier is a field element (below the BN254 modulus). */
export const GIWA_TEST_NULLIFIER = '0x0' + 'f'.repeat(63);
export const GIWA_OPRF = { keyHash: 128, domain: 129, scope: 130, nullifier: 131 } as const;
/** attested_at, the device statement's unix seconds, after the OPRF fields. */
export const GIWA_ATTESTED_AT_INDEX = 132;
/** 2026-11-27T08:37:34Z, the vault's deploy block time; a policy fixture value, not a live clock. */
export const TEST_ATTESTED_AT = '0x' + (1795768654).toString(16).padStart(64, '0');
export const GIWA_TEST_VAULT = '0x1111111111111111111111111111111111111111';
export const GIWA_TEST_ACCOUNT = '0x2222222222222222222222222222222222222222';
export const GIWA_TEST_TOKEN = '0x417573024528f3c9daD782eF5316E992F3029e81';
export const GIWA_TEST_ROOT = keccak256('0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b');
export const ZERO_WORD = '0x' + '00'.repeat(32);
export const giwaFields = (hex: string) => hex.slice(2).match(/../g)!.map(byte => `0x${byte.padStart(64, '0')}`);

/**
 * A proof of the byte length the package produces. giwa_attestation and
 * dojang_playground have three packages, which the SDK tells apart by length,
 * so a short placeholder is refused before any policy runs.
 */
export function packageProofHex(circuit: string, variant: SignerVariant = 'standard'): string {
  const log = getCircuitPackage(circuit, variant).logCircuitSize;
  if (log === undefined) throw new Error(`The ${circuit} '${variant}' package names no logCircuitSize.`);
  return '0x' + 'ab'.repeat(evmProofByteLength(log));
}

// Independently specified contract payload; never derived from the builder under test.
export function depositAction(): TypedAction {
  return {
    domain: { name: 'Gotgan', version: '2', chainId: 91342, verifyingContract: GIWA_TEST_VAULT },
    primaryType: 'Deposit',
    types: { Deposit: [
      { name: 'account', type: 'address' }, { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    ] },
    message: { account: GIWA_TEST_ACCOUNT, asset: GIWA_TEST_TOKEN, amount: '1000000', nonce: '0' },
  };
}

// Policy fixture only. These bytes are not a cryptographic proof and never
// stand in for phone generation or verifier success in an E2E test.
// 128 byte-valued inputs (signal, EIP-712 domain, action, issuer root), then
// the OPRF key hash, domain, scope and nullifier as whole field elements, then
// attested_at. `variant` given: the result names that package, as the relay does.
export function giwaResult(scope: string, action?: TypedAction, variant?: SignerVariant): RelayProofResult {
  return {
    requestId: 'current-request', status: 'completed', circuit: CIRCUIT_IDS.GIWA_ATTESTATION,
    chainId: 91342, verifierAddress: GIWA_TEST_VERIFIERS[variant ?? 'standard'], proof: packageProofHex(CIRCUIT_IDS.GIWA_ATTESTATION, variant),
    ...(variant !== undefined && { signerVariant: variant }),
    publicInputs: [
      ZERO_WORD,
      action ? TypedDataEncoder.hashDomain(action.domain) : ZERO_WORD,
      action ? TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message) : ZERO_WORD,
      GIWA_TEST_ROOT,
    ].flatMap(giwaFields).concat([TESTNET_OPRF_KEY_HASH, DEMO_DOMAIN_FIELD, reduceOprfName(scope), GIWA_TEST_NULLIFIER, TEST_ATTESTED_AT]),
  };
}
