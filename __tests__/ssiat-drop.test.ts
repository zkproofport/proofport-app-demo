import { describe, expect, it } from 'vitest';
import { extractNullifierFromPublicInputs, extractScopeFromPublicInputs } from '@zkproofport-app/sdk';
import { getBytes, Interface, keccak256, MaxUint256, toUtf8Bytes, TypedDataEncoder } from 'ethers';
import {
  buildSsiatClaimAction, displaySeed, expectedSsiatScope, prepareSsiatClaimProof, SSIAT_DROP_ABI, SSIAT_DROP_ADDRESS,
  SSIAT_SCOPE_PATTERN, ssiatDropAddress, ssiatErrorMessage, ssiatErrorName, ssiatScopeHash,
} from '../lib/ssiat-drop';
import {
  byteFields, claimAction, SSIAT_TEST_DROP, SSIAT_TEST_NULLIFIER, SSIAT_TEST_RECIPIENT, SSIAT_TEST_SCOPE, ssiatResult,
} from './fixtures/ssiat';

const BOB = '0x0000000000000000000000000000000000000B0B';
const abi = new Interface(SSIAT_DROP_ABI);
const prepare = (result = ssiatResult(SSIAT_TEST_SCOPE, claimAction()), action = claimAction()) =>
  prepareSsiatClaimProof(result, 'current-request', SSIAT_TEST_SCOPE, action);

describe('the drop address is the deployed one, and a missing one fails loudly', () => {
  it('ships the drop deployed on GIWA Sepolia, whose claimScope() read over RPC was this string', () => {
    expect(SSIAT_DROP_ADDRESS).toBe('0xA7D93C4699e86AF9f60EcBe1A1D90297fcc57dFf');
    expect(ssiatDropAddress()).toBe(SSIAT_DROP_ADDRESS);
    expect(expectedSsiatScope(SSIAT_DROP_ADDRESS)).toBe('ssiat-drop:v1:2ed6472da94b57988b11e3d8239f5bef6bf31be1ef984cf4c9adac300479eacf');
  });
  it('an empty address is refused rather than replaced', () => {
    expect(() => ssiatDropAddress('')).toThrow(/not deployed yet.*SSIAT_DROP_ADDRESS/);
  });
  it.each([' ', '0x', '0x1234', '0x' + '00'.repeat(20), '0x' + 'gg'.repeat(20), '0x' + '11'.repeat(21), '%_\\', '<script>', '씨앗👛'])(
    'refuses an unusable configured address: %s', value => {
      expect(() => ssiatDropAddress(value)).toThrow(/not a usable contract address/);
    },
  );
  it('accepts a real address unchanged', () => {
    expect(ssiatDropAddress(SSIAT_TEST_DROP)).toBe(SSIAT_TEST_DROP);
  });
});

describe('the claim action, scope and hashes match the contract', () => {
  it('builds exactly Claim(recipient) under the Ssiat v1 domain', () => {
    expect(buildSsiatClaimAction(SSIAT_TEST_RECIPIENT, SSIAT_TEST_DROP)).toEqual(claimAction());
  });
  it('produces the same vectors the Foundry test pins for SsiatDrop at 0x1111…1111', () => {
    const action = buildSsiatClaimAction(SSIAT_TEST_RECIPIENT, SSIAT_TEST_DROP);
    // Same constants as testDomainActionAndScopeMatchIndependentEthersVectors in contracts/test/SsiatDrop.t.sol.
    expect(TypedDataEncoder.hashDomain(action.domain)).toBe('0x23ab5e17f1fc30358e780537cd832a814bb55fa1bab072fc84c450088ecd89e7');
    expect(TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message)).toBe('0xea55ff6513499a985fe58064fa898e3356e095ef50a294d4888eb0602a442b1e');
    expect(expectedSsiatScope(SSIAT_TEST_DROP)).toBe(SSIAT_TEST_SCOPE);
    expect(ssiatScopeHash(SSIAT_TEST_SCOPE)).toBe('0xc69788fa294dd279cd16e71d89f1e5825e56babd7413eed1baf2db7ed1bf12f5');
  });
  it('hashes the scope string the way the mobile app does: keccak256 of its UTF-8 bytes, once', () => {
    // proofport-app computeScope: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(scopeString)).
    for (const scope of [SSIAT_TEST_SCOPE, '씨앗 🌱', 'tab\tand\nnewline']) {
      expect(ssiatScopeHash(scope)).toBe(keccak256(toUtf8Bytes(scope)));
    }
    expect(ssiatScopeHash('씨앗')).not.toBe(keccak256(Uint8Array.from([..."씨앗"].map(c => c.charCodeAt(0) & 255))));
  });
  it('gives a scope that does not depend on the recipient, and one per drop and chain', () => {
    expect(SSIAT_SCOPE_PATTERN.test(SSIAT_TEST_SCOPE)).toBe(true);
    expect(expectedSsiatScope(SSIAT_TEST_DROP)).toBe(expectedSsiatScope(SSIAT_TEST_DROP));
    expect(expectedSsiatScope('0x2222222222222222222222222222222222222222')).not.toBe(SSIAT_TEST_SCOPE);
    expect(expectedSsiatScope(SSIAT_TEST_DROP, 1)).not.toBe(SSIAT_TEST_SCOPE);
  });
  it('binds the recipient: another recipient is another action hash', () => {
    const a = buildSsiatClaimAction(SSIAT_TEST_RECIPIENT, SSIAT_TEST_DROP);
    const b = buildSsiatClaimAction(BOB, SSIAT_TEST_DROP);
    expect(TypedDataEncoder.hashStruct('Claim', a.types, a.message)).not.toBe(TypedDataEncoder.hashStruct('Claim', b.types, b.message));
  });
  it.each(['', ' ', '0x', '0x1234', '0x' + '00'.repeat(20), '0x' + 'gg'.repeat(20), '0x' + '11'.repeat(21), '%_\\', '<script>', '한글👛'])(
    'refuses an unusable recipient or drop address: %j', address => {
      expect(() => buildSsiatClaimAction(address, SSIAT_TEST_DROP)).toThrow(/recipient/);
      expect(() => buildSsiatClaimAction(SSIAT_TEST_RECIPIENT, address)).toThrow(/drop contract/);
      expect(() => expectedSsiatScope(address)).toThrow(/drop contract/);
    },
  );
  it.each([null, undefined])('refuses a missing recipient: %s', value => {
    expect(() => buildSsiatClaimAction(value as unknown as string, SSIAT_TEST_DROP)).toThrow(/recipient/);
  });
});

describe('a returned proof is checked against the requested claim', () => {
  it('accepts the exact claim and reads the nullifier where the SDK says it is', () => {
    const accepted = prepare();
    expect(accepted.nullifier).toBe(SSIAT_TEST_NULLIFIER);
    expect(accepted.recipient).toBe(SSIAT_TEST_RECIPIENT);
    expect(accepted.publicInputs).toHaveLength(160);
    for (const input of accepted.publicInputs) expect(input).toMatch(/^0x[0-9a-f]{64}$/);
    const raw = ssiatResult(SSIAT_TEST_SCOPE, claimAction()).publicInputs!;
    expect(extractNullifierFromPublicInputs(raw, 'dojang_playground')).toBe(SSIAT_TEST_NULLIFIER);
    expect(extractScopeFromPublicInputs(raw, 'dojang_playground')).toBe(ssiatScopeHash(SSIAT_TEST_SCOPE));
  });
  it('accepts short hex fields and the byte 0xff', () => {
    const result = ssiatResult(SSIAT_TEST_SCOPE, claimAction(), '0x' + 'ff'.repeat(32));
    result.publicInputs = result.publicInputs!.map(value => '0x' + BigInt(value).toString(16));
    expect(prepare(result).nullifier).toBe('0x' + 'ff'.repeat(32));
  });
  it('refuses a proof for another recipient: the copied-proof redirect', () => {
    expect(() => prepare(ssiatResult(SSIAT_TEST_SCOPE, claimAction(BOB)))).toThrow(/different recipient/);
  });
  it('refuses a proof for another drop contract or app domain', () => {
    expect(() => prepare(ssiatResult(SSIAT_TEST_SCOPE, claimAction(SSIAT_TEST_RECIPIENT, '0x2222222222222222222222222222222222222222')))).toThrow(/different app or contract/);
    const gotgan = { ...claimAction(), domain: { ...claimAction().domain, name: 'Gotgan' } };
    expect(() => prepare(ssiatResult(SSIAT_TEST_SCOPE, gotgan))).toThrow(/different app or contract/);
  });
  it('refuses an identity-only proof (nonzero signal, no action)', () => {
    expect(() => prepare(ssiatResult(SSIAT_TEST_SCOPE))).toThrow(/claim action/);
  });
  it('refuses a nonzero signal alongside the right action', () => {
    const result = ssiatResult(SSIAT_TEST_SCOPE, claimAction());
    result.publicInputs![31] = '0x' + '1'.padStart(64, '0');
    expect(() => prepare(result)).toThrow(/claim action/);
  });
  it.each(['proofport:dojang-playground', 'giwa-vault:v1:' + 'ab'.repeat(32), expectedSsiatScope('0x2222222222222222222222222222222222222222'), ''])(
    'refuses a proof made for another scope: %j', scope => {
      expect(() => prepare(ssiatResult(scope, claimAction()))).toThrow(/different drop/);
    },
  );
  it.each([
    ['another request', { requestId: 'old-request' }, /different request/],
    ['a pending status', { status: 'pending' }, /No completed proof/],
    ['no proof', { proof: undefined }, /No completed proof/],
    ['an empty proof', { proof: '0x' }, /No completed proof/],
    ['an odd-length proof', { proof: '0x123' }, /No completed proof/],
    ['a non-hex proof', { proof: '<script>' }, /No completed proof/],
    ['another circuit', { circuit: 'giwa_attestation' }, /dojang_playground proof is required/],
    ['no circuit', { circuit: undefined }, /dojang_playground proof is required/],
    ['another chain', { chainId: 84532 }, /Dojang Playground verifier/],
    ['another verifier', { verifierAddress: '0x2d01c2fe3445b7dde60118f956bb14e84fd64724' }, /Dojang Playground verifier/],
    ['no public inputs', { publicInputs: undefined }, /public-input format/],
    ['159 public inputs', { publicInputs: Array(159).fill('0x00') }, /public-input format/],
    ['161 public inputs', { publicInputs: Array(161).fill('0x00') }, /public-input format/],
    ['192 public inputs (the GIWA layout)', { publicInputs: Array(192).fill('0x00') }, /public-input format/],
  ])('refuses %s', (_, patch, message) => {
    expect(() => prepare({ ...ssiatResult(SSIAT_TEST_SCOPE, claimAction()), ...patch } as never)).toThrow(message);
  });
  it.each([
    [0, '0x100'], [159, '0x' + 'f'.repeat(64)], [96, '0x100'],
  ])('refuses a public input that is not a byte, at index %i', (index, value) => {
    const result = ssiatResult(SSIAT_TEST_SCOPE, claimAction());
    result.publicInputs![index] = value;
    expect(() => prepare(result)).toThrow(new RegExp(`Public input ${index} is not a byte`));
  });
  it.each(['', '0x', 'zz', '0xzz', '<script>', '0x' + '0'.repeat(65), ' 0x01', null, 1])('refuses a malformed public input: %j', value => {
    const result = ssiatResult(SSIAT_TEST_SCOPE, claimAction());
    (result.publicInputs as unknown[])[40] = value;
    expect(() => prepare(result)).toThrow(/Malformed public input/);
  });
  it('refuses a structurally invalid expected action instead of comparing against it', () => {
    const broken = { ...claimAction(), primaryType: 'Missing' };
    expect(() => prepare(ssiatResult(SSIAT_TEST_SCOPE, claimAction()), broken)).toThrow(/Invalid claim action/);
  });
});

describe('contract errors are named, and every one has words', () => {
  it('decodes each SsiatDrop error from every place ethers puts revert data', () => {
    const data = abi.encodeErrorResult('AlreadyClaimed', [SSIAT_TEST_NULLIFIER]);
    expect(ssiatErrorName({ data })).toBe('AlreadyClaimed');
    expect(ssiatErrorName({ info: { error: { data } } })).toBe('AlreadyClaimed');
    expect(ssiatErrorName({ info: { error: { data: { data } } } })).toBe('AlreadyClaimed');
  });
  it('does not mistake an RPC failure or foreign revert for a drop answer', () => {
    expect(ssiatErrorName(new Error('RPC unavailable'))).toBeUndefined();
    expect(ssiatErrorName({ data: '0x1234' })).toBeUndefined();
    expect(ssiatErrorName(null)).toBeUndefined();
    expect(ssiatErrorMessage(new Error('RPC unavailable'))).toBe('RPC unavailable');
  });
  it('has a message for every error in the ABI', () => {
    const errors = SSIAT_DROP_ABI.filter(line => line.startsWith('error ')).map(line => line.slice(6, line.indexOf('(')));
    expect(errors.length).toBeGreaterThan(10);
    for (const name of errors) {
      const fragment = abi.getError(name)!;
      const data = abi.encodeErrorResult(fragment, fragment.inputs.map(input => input.type === 'bytes32' ? SSIAT_TEST_NULLIFIER : 1));
      expect(ssiatErrorMessage({ data }), name).not.toMatch(/could not finish/);
    }
  });
  it('treats a declined wallet prompt as declined', () => {
    expect(ssiatErrorMessage({ code: 4001 })).toMatch(/declined/);
    expect(ssiatErrorMessage({ code: 'ACTION_REJECTED' })).toMatch(/declined/);
  });
});

describe('SEED amounts are exact 18-decimal integers', () => {
  it.each([
    [null, '—'], [BigInt(0), '0'], [BigInt(1), '0.000000000000000001'],
    [BigInt('100000000000000000000'), '100'], [BigInt('1000000000000000000000000'), '1,000,000'],
  ])('shows %s as %s', (value, text) => {
    expect(displaySeed(value as bigint | null)).toBe(text);
  });
  it('shows the largest uint256 without losing digits', () => {
    const text = displaySeed(MaxUint256);
    expect(text.replace(/[,.]/g, '').replace(/^0+/, '')).toBe(MaxUint256.toString());
  });
});

describe('fixtures put each field where the circuit declares it', () => {
  it('lays out signal, domain, action, scope and nullifier at 0/32/64/96/128', () => {
    const inputs = ssiatResult(SSIAT_TEST_SCOPE, claimAction()).publicInputs!;
    expect(inputs.slice(128)).toEqual(byteFields(SSIAT_TEST_NULLIFIER));
    expect(inputs.slice(96, 128)).toEqual(byteFields(ssiatScopeHash(SSIAT_TEST_SCOPE)));
    expect(getBytes(SSIAT_TEST_NULLIFIER)).toHaveLength(32);
  });
});
