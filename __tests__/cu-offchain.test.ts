import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetOffChainVerifier, verifyOffChain, vkUrl } from '../lib/kproof/offchain';

const proof = '0x' + readFileSync(join(__dirname, 'fixtures/kproof-age/proof')).toString('hex');
const raw = readFileSync(join(__dirname, 'fixtures/kproof-age/public_inputs'));
const words = Array.from(
  { length: raw.length / 32 },
  (_, i) => '0x' + raw.subarray(i * 32, i * 32 + 32).toString('hex')
);
const key = readFileSync(join(__dirname, '../public/kproof/vk/mdl_kr_age.bin'));
const keyServer = () =>
  vi.fn(async (url: unknown) => {
    expect(url).toBe(vkUrl('mdl_kr_age'));
    return new Response(new Uint8Array(key));
  }) as unknown as typeof fetch;
afterEach(() => resetOffChainVerifier());

describe('CU uses the KProof WASM verifier, not an RPC or simulated verification', () => {
  it('verifies a real KProof age proof against the bundled, hash-pinned key', async () => {
    const result = await verifyOffChain('mdl_kr_age', proof, words, { fetchImpl: keyServer() });
    expect(result.valid).toBe(true);
  }, 60_000);
  it('rejects tampered public inputs with the real verifier', async () => {
    const altered = [...words];
    altered[0] = '0x' + '00'.repeat(31) + (words[0].endsWith('01') ? '02' : '01');
    expect((await verifyOffChain('mdl_kr_age', proof, altered, { fetchImpl: keyServer() })).valid).toBe(
      false
    );
  }, 60_000);
  it('refuses a modified verification key', async () => {
    const corrupt = new Uint8Array(key);
    corrupt[0] ^= 255;
    await expect(
      verifyOffChain('mdl_kr_age', proof, words, {
        fetchImpl: vi.fn(async () => new Response(corrupt)),
      })
    ).rejects.toThrow(/sha256/);
  }, 60_000);
});
