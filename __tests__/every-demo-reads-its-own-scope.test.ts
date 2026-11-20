import { describe, it, expect } from 'vitest';
import { getBytes } from 'ethers';
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT as KYC, COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT as COUNTRY,
  HUMAN_PASSPORT_SCORE_PUBLIC_INPUT_LAYOUT as PASSPORT, extractScopeFromPublicInputs,
} from '@zkproofport-app/sdk';
import { COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT, reduceOprfName } from '@zkproofport-app/core';
import { cardResult, CARD_NULLIFIER, proofHex } from './fixtures/card-proofs';
import { DEMO_DOMAIN_FIELD, TESTNET_OPRF_KEY_HASH } from './fixtures/giwa';
import { COINBASE_SIGNER_ROOT, DEFAULT_OPTIONS, prepareDemoProof } from '../lib/demo-policy';
import { verifierAddress } from '../lib/verifier-deployments';
import { DEMOS } from '../lib/demo-catalog';

/**
 * A returned proof is matched to its request by scope — and the scope sits in a
 * different place in every circuit's public inputs.
 *
 * The demo used to choose that place with a chain of `demo.id === …` whose last
 * branch was one circuit's offset, byte 0. Every circuit the chain did not name
 * fell into it, so a correct proof had its scope read from byte 0 and came back
 * as "This proof does not match the requested session" — the app had done
 * everything right. Asking core, which keys the offsets per circuit and throws
 * on an unknown one, is what makes a new circuit impossible to get wrong by
 * omission.
 */
const kyc = DEMOS.find(demo => demo.id === 'kyc')!;
const scope = 'markets:kyc:0xfeed';

/** A Coinbase KYC proof-shaped answer whose scope field sits at `at` (the other OPRF fields where KYC keeps them). */
function kycResult(at: number) {
  const inputs = Array.from({ length: COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT }, () => '0x00');
  getBytes(COINBASE_SIGNER_ROOT).forEach((byte, index) => { inputs[KYC.MERKLE_ROOT_START + index] = '0x' + byte.toString(16).padStart(2, '0'); });
  inputs[KYC.OPRF_KEY_HASH] = TESTNET_OPRF_KEY_HASH;
  inputs[KYC.OPRF_DOMAIN] = DEMO_DOMAIN_FIELD;
  inputs[KYC.NULLIFIER] = CARD_NULLIFIER;
  inputs[at] = reduceOprfName(scope);
  return {
    requestId: 'req-1', circuit: kyc.circuit, status: 'completed' as const, proof: proofHex(kyc.circuit),
    chainId: 84532, verifierAddress: verifierAddress(kyc.circuit, 84532), publicInputs: inputs,
  };
}

const context = { demo: kyc, requestId: 'req-1', scope, options: DEFAULT_OPTIONS };

describe('every demo reads the scope where its own circuit keeps it', () => {
  it('accepts a Coinbase KYC proof whose scope sits at its layout\'s scope offset', () => {
    const accepted = prepareDemoProof(kycResult(KYC.SCOPE), context);
    expect(accepted.circuit).toBe(kyc.circuit);
    expect(accepted.publicInputs).toHaveLength(COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT);
  });

  it('refuses the same proof when the scope sits where another circuit or an earlier layout keeps it', () => {
    // Byte 0 is where the old chain's last branch read, 64 the v1 KYC offset,
    // 128 the pre-OPRF KYC v2 one; the nullifier's slot is the field beside it.
    for (const wrong of [0, 64, 128, KYC.NULLIFIER]) {
      const result = kycResult(wrong);
      if (wrong === KYC.NULLIFIER) result.publicInputs[KYC.SCOPE] = '0x00';
      expect(() => prepareDemoProof(result, context), String(wrong)).toThrow(/does not match the requested session/);
    }
  });

  it('asks the SDK for the offset, which knows one per circuit', () => {
    const inputs = kycResult(KYC.SCOPE).publicInputs;
    expect(extractScopeFromPublicInputs(inputs, kyc.circuit)).toBe(reduceOprfName(scope));
    // Coinbase Country keeps its scope further on, past the end of a KYC proof.
    expect(COUNTRY.SCOPE).toBeGreaterThanOrEqual(inputs.length);
    expect(extractScopeFromPublicInputs(inputs, 'coinbase_country_attestation')).not.toBe(reduceOprfName(scope));
  });

  it('refuses a circuit the SDK has no offset for, rather than picking one', () => {
    expect(() => extractScopeFromPublicInputs(kycResult(KYC.SCOPE).publicInputs, 'not_a_circuit')).toThrow();
  });

  it('reads a Human Passport proof\'s scope where that circuit keeps it', () => {
    const passport = DEMOS.find(demo => demo.id === 'passport')!;
    const result = cardResult('passport', 'req-1', scope);
    const passportContext = { demo: passport, requestId: 'req-1', scope, options: DEFAULT_OPTIONS };
    expect(extractScopeFromPublicInputs(result.publicInputs!, passport.circuit)).toBe(reduceOprfName(scope));
    expect(prepareDemoProof(result, passportContext).circuit).toBe(passport.circuit);
    // The same scope field moved anywhere else is someone else's session.
    const moved = [...result.publicInputs!];
    moved[0] = moved[PASSPORT.SCOPE]; moved[PASSPORT.SCOPE] = '0x00';
    expect(() => prepareDemoProof({ ...result, publicInputs: moved }, passportContext)).toThrow(/does not match the requested session/);
  });
});
