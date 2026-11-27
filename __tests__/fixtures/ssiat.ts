import { CIRCUIT_IDS, type RelayProofResult, type SignerVariant, type TypedAction } from '@zkproofport-app/sdk';
import { reduceOprfName } from '@zkproofport-app/core';
import { keccak256, toUtf8Bytes, TypedDataEncoder } from 'ethers';
import { DEMO_DOMAIN_FIELD, packageProofHex, TEST_ATTESTED_AT, TESTNET_OPRF_KEY_HASH } from './giwa';

export const SSIAT_TEST_DROP = '0x1111111111111111111111111111111111111111';
export const SSIAT_TEST_RECIPIENT = '0x00000000000000000000000000000000000A11CE';
/**
 * The dojang_playground v2 verifiers on GIWA Sepolia, one per signer package,
 * written out from circuits/deployments/91342/DojangPlaygroundV2*.json.
 */
export const SSIAT_TEST_VERIFIERS: Record<SignerVariant, string> = {
  standard: '0xc1c42ade7c31afdf99fbaedf97da5b07fccba724',
  android: '0x7fc2059a73cef2b572c8deee911c72963dcb4a8a',
  android_factory: '0x0b3af3dfc67dc65e0145c37ee00230139d579f64',
};
export const SSIAT_TEST_VERIFIER = SSIAT_TEST_VERIFIERS.standard;
/** The previous (100-input, bb 6.0.0) Dojang verifier, retired with the v2 circuits. */
export const SSIAT_RETIRED_VERIFIER = '0x400474e78a793289d091a5f556f78158956b5d01';
/** An OPRF nullifier is a field element, below the BN254 modulus. */
export const SSIAT_TEST_NULLIFIER = '0x0' + 'ab'.repeat(31) + 'a';
export const SSIAT_OPRF = { keyHash: 96, domain: 97, scope: 98, nullifier: 99 } as const;
/** attested_at, the device statement's unix seconds, after the OPRF fields. */
export const SSIAT_ATTESTED_AT_INDEX = 100;
const ZERO_WORD = '0x' + '00'.repeat(32);
export const byteFields = (hex: string) => hex.slice(2).match(/../g)!.map(byte => `0x${byte.padStart(64, '0')}`);

/**
 * Written out by hand, never derived from the builder under test. The vectors in
 * __tests__/ssiat-drop.test.ts and contracts/test/SsiatDrop.t.sol use the same values.
 */
export function claimAction(recipient = SSIAT_TEST_RECIPIENT, drop = SSIAT_TEST_DROP): TypedAction {
  return {
    domain: { name: 'Ssiat', version: '1', chainId: 91342, verifyingContract: drop },
    primaryType: 'Claim',
    types: { Claim: [{ name: 'recipient', type: 'address' }] },
    message: { recipient },
  };
}

/** The scope SsiatDrop.claimScope() returns for SSIAT_TEST_DROP on chain 91342. */
export const SSIAT_TEST_SCOPE = 'ssiat-drop:v1:c9530063dbdc15541fb42838f47b7e10008bb48373da7b5d1ac82fbdb6a20e12';

// Policy fixture only: the bytes are not a cryptographic proof, and nothing here
// stands in for the phone generating one or the verifier accepting it.
// 96 byte-valued inputs (signal, EIP-712 domain, action), then the OPRF key
// hash, domain, scope and nullifier as whole field elements, then attested_at.
// `variant` given: the result names that package, as the relay does.
export function ssiatResult(scope: string, action?: TypedAction, nullifier = SSIAT_TEST_NULLIFIER, variant?: SignerVariant): RelayProofResult {
  return {
    requestId: 'current-request', status: 'completed', circuit: CIRCUIT_IDS.DOJANG_PLAYGROUND,
    chainId: 91342, verifierAddress: SSIAT_TEST_VERIFIERS[variant ?? 'standard'], proof: packageProofHex(CIRCUIT_IDS.DOJANG_PLAYGROUND, variant),
    ...(variant !== undefined && { signerVariant: variant }),
    publicInputs: [
      action ? ZERO_WORD : keccak256(toUtf8Bytes('identity signal')),
      action ? TypedDataEncoder.hashDomain(action.domain) : ZERO_WORD,
      action ? TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message) : ZERO_WORD,
    ].flatMap(byteFields).concat([TESTNET_OPRF_KEY_HASH, DEMO_DOMAIN_FIELD, reduceOprfName(scope), nullifier, TEST_ATTESTED_AT]),
  };
}
