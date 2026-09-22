import { CIRCUIT_IDS, type RelayProofResult, type TypedAction } from '@zkproofport-app/sdk';
import { keccak256, toUtf8Bytes, TypedDataEncoder } from 'ethers';

export const GIWA_TEST_VERIFIER = '0x5da234546874304f8c51bbeed00fc632938211c1';
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
export function giwaResult(scope: string, action?: TypedAction): RelayProofResult {
  return {
    requestId: 'current-request', status: 'completed', circuit: CIRCUIT_IDS.GIWA_ATTESTATION,
    chainId: 91342, verifierAddress: GIWA_TEST_VERIFIER, proof: '0x1234',
    publicInputs: [
      ZERO_WORD,
      action ? TypedDataEncoder.hashDomain(action.domain) : ZERO_WORD,
      action ? TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message) : ZERO_WORD,
      GIWA_TEST_ROOT, keccak256(toUtf8Bytes(scope)), '0x' + 'ff'.repeat(32),
    ].flatMap(giwaFields),
  };
}
