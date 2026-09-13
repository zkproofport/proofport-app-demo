import { describe, it, expect } from 'vitest';
import { keccak256, toUtf8Bytes } from 'ethers';
import { extractScopeFromPublicInputs } from '@zkproofport-app/sdk';
import { DEFAULT_OPTIONS, DEMO_VERIFIERS, prepareDemoProof } from '../lib/demo-policy';
import { DEMOS } from '../lib/demo-catalog';

/**
 * A returned proof is matched to its request by scope — and the scope sits in a
 * different place in every circuit's public inputs.
 *
 * The demo used to choose that place with a chain of `demo.id === …` whose last
 * branch was the Korean mobile ID offset. Every circuit the chain did not name
 * fell into it, so an Arc proof had its scope read from byte 0 and came back as
 * "This proof does not match the requested session" — the app had done
 * everything right. Asking the SDK, which keys the offsets per circuit and
 * throws on an unknown one, is what makes a new circuit impossible to get wrong
 * by omission.
 */
const arc = DEMOS.find(demo => demo.id === 'arc')!;
const scope = 'ledger house:arc:0xfeed';

/** A proof-shaped answer whose scope bytes sit at `at`. */
function arcResult(at: number) {
  const inputs = Array.from({ length: 192 }, () => '0x00');
  const hash = keccak256(toUtf8Bytes(scope)).slice(2);
  for (let index = 0; index < 32; index += 1) inputs[at + index] = '0x' + hash.slice(index * 2, index * 2 + 2);
  return {
    requestId: 'req-1', circuit: arc.circuit, status: 'completed' as const, proof: '0xabcd',
    chainId: 5042002, verifierAddress: DEMO_VERIFIERS[arc.circuit][5042002], publicInputs: inputs,
  };
}

const context = { demo: arc, requestId: 'req-1', scope, options: DEFAULT_OPTIONS, year: 2026 };

describe('every demo reads the scope where its own circuit keeps it', () => {
  it('accepts an Arc proof whose scope sits at byte 128', () => {
    const accepted = prepareDemoProof(arcResult(128), context);
    expect(accepted.circuit).toBe(arc.circuit);
    expect(accepted.publicInputs).toHaveLength(192);
  });

  it('refuses the same proof when the scope sits where another circuit keeps it', () => {
    // Byte 0 is the Korean mobile ID offset, and byte 64 the Coinbase one.
    for (const wrong of [0, 64]) {
      expect(() => prepareDemoProof(arcResult(wrong), context)).toThrow(/does not match the requested session/);
    }
  });

  it('asks the SDK for the offset, which knows one per circuit', () => {
    const inputs = arcResult(128).publicInputs;
    expect(extractScopeFromPublicInputs(inputs, arc.circuit)).toBe(keccak256(toUtf8Bytes(scope)));
    // The same bytes read as a Coinbase proof land somewhere else entirely.
    expect(extractScopeFromPublicInputs(inputs, 'coinbase_attestation')).not.toBe(keccak256(toUtf8Bytes(scope)));
  });

  it('refuses a circuit the SDK has no offset for, rather than picking one', () => {
    expect(() => extractScopeFromPublicInputs(arcResult(128).publicInputs, 'not_a_circuit')).toThrow();
  });
});
