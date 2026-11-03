import { describe, it, expect } from 'vitest';
import { getBytes, keccak256, toUtf8Bytes } from 'ethers';
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT as KYC, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT as PASSPORT, OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT as OIDC, extractScopeFromPublicInputs,
} from '@zkproofport-app/sdk';
import { COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT } from '@zkproofport-app/core';
import { cardResult, proofHex } from './fixtures/card-proofs';
import { COINBASE_SIGNER_ROOT, DEFAULT_OPTIONS, DEMO_VERIFIERS, prepareDemoProof } from '../lib/demo-policy';
import { DEMOS } from '../lib/demo-catalog';

/**
 * A returned proof is matched to its request by scope — and the scope sits in a
 * different place in every circuit's public inputs.
 *
 * The demo used to choose that place with a chain of `demo.id === …` whose last
 * branch was one circuit's offset, byte 0. Every circuit the chain did not name
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
  const inputs = Array.from({ length: COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT }, () => '0x00');
  const put = (start: number, hex: string) => getBytes(hex).forEach((byte, index) => {
    inputs[start + index] = '0x' + byte.toString(16).padStart(2, '0');
  });
  put(KYC.MERKLE_ROOT_START, COINBASE_SIGNER_ROOT);
  put(at, keccak256(toUtf8Bytes(scope)));
  return {
    requestId: 'req-1', circuit: kyc.circuit, status: 'completed' as const, proof: proofHex(kyc.circuit),
    chainId: 84532, verifierAddress: DEMO_VERIFIERS[kyc.circuit][84532], publicInputs: inputs,
  };
}

const context = { demo: kyc, requestId: 'req-1', scope, options: DEFAULT_OPTIONS };

describe('every demo reads the scope where its own circuit keeps it', () => {
  it('accepts a Coinbase KYC proof whose scope sits at its layout\'s scope offset', () => {
    const accepted = prepareDemoProof(kycResult(KYC.SCOPE_START), context);
    expect(accepted.circuit).toBe(kyc.circuit);
    expect(accepted.publicInputs).toHaveLength(COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT);
  });

  it('refuses the same proof when the scope sits where another circuit keeps it', () => {
    // Byte 0 is where the old chain's last branch read, 64 the v1 KYC
    // offset, then the email circuit's and the Coinbase Country one's.
    for (const wrong of [0, 64, OIDC.SCOPE_START, COUNTRY.SCOPE_START]) {
      expect(() => prepareDemoProof(kycResult(wrong), context)).toThrow(/does not match the requested session/);
    }
  });

  it('asks the SDK for the offset, which knows one per circuit', () => {
    const inputs = kycResult(KYC.SCOPE_START).publicInputs;
    expect(extractScopeFromPublicInputs(inputs, kyc.circuit)).toBe(keccak256(toUtf8Bytes(scope)));
    // The same bytes read as a Coinbase Country proof land somewhere else entirely.
    expect(extractScopeFromPublicInputs(inputs, 'coinbase_country_attestation')).not.toBe(keccak256(toUtf8Bytes(scope)));
  });

  it('refuses a circuit the SDK has no offset for, rather than picking one', () => {
    expect(() => extractScopeFromPublicInputs(kycResult(KYC.SCOPE_START).publicInputs, 'not_a_circuit')).toThrow();
  });

  it('reads a Human Passport proof\'s scope where that circuit keeps it', () => {
    const passport = DEMOS.find(demo => demo.id === 'passport')!;
    const result = cardResult('passport', 'req-1', scope);
    const passportContext = { demo: passport, requestId: 'req-1', scope, options: DEFAULT_OPTIONS };
    expect(extractScopeFromPublicInputs(result.publicInputs!, passport.circuit)).toBe(keccak256(toUtf8Bytes(scope)));
    expect(prepareDemoProof(result, passportContext).circuit).toBe(passport.circuit);
    // The same scope bytes moved anywhere else are someone else's session.
    const moved = [...result.publicInputs!];
    for (let index = 0; index < 32; index++) { moved[index] = moved[PASSPORT.SCOPE_START + index]; moved[PASSPORT.SCOPE_START + index] = '0x00'; }
    expect(() => prepareDemoProof({ ...result, publicInputs: moved }, passportContext)).toThrow(/does not match the requested session/);
  });
});
