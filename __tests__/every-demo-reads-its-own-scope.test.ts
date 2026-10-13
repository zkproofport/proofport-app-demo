import { describe, it, expect } from 'vitest';
import { getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { extractScopeFromPublicInputs } from '@zkproofport-app/sdk';
import { COINBASE_SIGNER_ROOT, DEFAULT_OPTIONS, DEMO_VERIFIERS, prepareDemoProof } from '../lib/demo-policy';
import { DEMOS } from '../lib/demo-catalog';

/**
 * A returned proof is matched to its request by scope — and the scope sits in a
 * different place in every circuit's public inputs.
 *
 * The demo used to choose that place with a chain of `demo.id === …` whose last
 * branch was the Korean mobile ID offset. Every circuit the chain did not name
 * fell into it, so a correct proof had its scope read from byte 0 and came back
 * as "This proof does not match the requested session" — the app had done
 * everything right. Asking the SDK, which keys the offsets per circuit and
 * throws on an unknown one, is what makes a new circuit impossible to get wrong
 * by omission.
 */
const kyc = DEMOS.find(demo => demo.id === 'kyc')!;
const scope = 'markets:kyc:0xfeed';

/** A Coinbase KYC proof-shaped answer whose scope bytes sit at `at`. */
function kycResult(at: number) {
  const inputs = Array.from({ length: 128 }, () => '0x00');
  const put = (start: number, hex: string) => getBytes(hex).forEach((byte, index) => {
    inputs[start + index] = '0x' + byte.toString(16).padStart(2, '0');
  });
  put(32, COINBASE_SIGNER_ROOT);
  put(at, keccak256(toUtf8Bytes(scope)));
  return {
    requestId: 'req-1', circuit: kyc.circuit, status: 'completed' as const, proof: '0xabcd',
    chainId: 84532, verifierAddress: DEMO_VERIFIERS[kyc.circuit][84532], publicInputs: inputs,
  };
}

const context = { demo: kyc, requestId: 'req-1', scope, options: DEFAULT_OPTIONS, year: 2026 };

describe('every demo reads the scope where its own circuit keeps it', () => {
  it('accepts a Coinbase KYC proof whose scope sits at byte 64', () => {
    const accepted = prepareDemoProof(kycResult(64), context);
    expect(accepted.circuit).toBe(kyc.circuit);
    expect(accepted.publicInputs).toHaveLength(128);
  });

  it('refuses the same proof when the scope sits where another circuit keeps it', () => {
    // Byte 0 is the Korean mobile ID offset, and byte 86 the Coinbase Country one.
    for (const wrong of [0, 86]) {
      expect(() => prepareDemoProof(kycResult(wrong), context)).toThrow(/does not match the requested session/);
    }
  });

  it('asks the SDK for the offset, which knows one per circuit', () => {
    const inputs = kycResult(64).publicInputs;
    expect(extractScopeFromPublicInputs(inputs, kyc.circuit)).toBe(keccak256(toUtf8Bytes(scope)));
    // The same bytes read as a Korean mobile ID proof land somewhere else entirely.
    expect(extractScopeFromPublicInputs(inputs, 'mdl_kr_ownership')).not.toBe(keccak256(toUtf8Bytes(scope)));
  });

  it('refuses a circuit the SDK has no offset for, rather than picking one', () => {
    expect(() => extractScopeFromPublicInputs(kycResult(64).publicInputs, 'not_a_circuit')).toThrow();
  });
});
