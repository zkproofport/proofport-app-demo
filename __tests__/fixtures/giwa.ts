import { CIRCUIT_IDS, type RelayProofResult, type TypedAction } from '@zkproofport-app/sdk';
import { reduceOprfName } from '@zkproofport-app/core';
import { keccak256, TypedDataEncoder } from 'ethers';

export const GIWA_TEST_VERIFIER = '0xa272056866453f0182426a29b9ca6382d6c6a060';
/** Written out, not read from the code under test: core's testnet OPRF key hash. */
export const TESTNET_OPRF_KEY_HASH = '0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1';
export const DEMO_DOMAIN = 'demo.zkproofport.app';
/** reduceOprfName('demo.zkproofport.app'), written out; the plain keccak256 is above the field modulus. */
export const DEMO_DOMAIN_FIELD = '0x0fd195923d45a11d40ac6c6d66108ede0763262945cd8c62a90491a5e3c13a32';
/** A nullifier is a field element (below the BN254 modulus). */
export const GIWA_TEST_NULLIFIER = '0x0' + 'f'.repeat(63);
export const GIWA_OPRF = { keyHash: 128, domain: 129, scope: 130, nullifier: 131 } as const;
export const GIWA_TEST_VAULT = '0x1111111111111111111111111111111111111111';
export const GIWA_TEST_ACCOUNT = '0x2222222222222222222222222222222222222222';
export const GIWA_TEST_TOKEN = '0x417573024528f3c9daD782eF5316E992F3029e81';
export const GIWA_TEST_ROOT = keccak256('0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b');
export const ZERO_WORD = '0x' + '00'.repeat(32);
export const giwaFields = (hex: string) => hex.slice(2).match(/../g)!.map(byte => `0x${byte.padStart(64, '0')}`);

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
// the OPRF key hash, domain, scope and nullifier as whole field elements.
export function giwaResult(scope: string, action?: TypedAction): RelayProofResult {
  return {
    requestId: 'current-request', status: 'completed', circuit: CIRCUIT_IDS.GIWA_ATTESTATION,
    chainId: 91342, verifierAddress: GIWA_TEST_VERIFIER, proof: '0x1234',
    publicInputs: [
      ZERO_WORD,
      action ? TypedDataEncoder.hashDomain(action.domain) : ZERO_WORD,
      action ? TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message) : ZERO_WORD,
      GIWA_TEST_ROOT,
    ].flatMap(giwaFields).concat([TESTNET_OPRF_KEY_HASH, DEMO_DOMAIN_FIELD, reduceOprfName(scope), GIWA_TEST_NULLIFIER]),
  };
}
