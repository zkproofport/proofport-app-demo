// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBytes, keccak256, toUtf8Bytes } from 'ethers';
import CircuitDemo from '../app/components/CircuitDemo';
import { demoById } from '../lib/demo-catalog';
import { COINBASE_SIGNER_ROOT, DEMO_VERIFIERS } from '../lib/demo-policy';

const external = vi.hoisted(() => ({ create: vi.fn(), qr: vi.fn(), wait: vi.fn(), onchain: vi.fn(), offchain: vi.fn(), disconnect: vi.fn() }));
vi.mock('../lib/sdk', () => ({ createSDK: () => ({ createRelayRequest: external.create, generateQRCode: external.qr, waitForProof: external.wait, verifyResponseOnChain: external.onchain, verifyResponseOffChain: external.offchain, disconnect: external.disconnect }) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const demo = demoById('kyc')!;
  external.create.mockImplementation(async (_circuit, inputs) => {
    const values = new Array(128).fill('0x00');
    const put = (start: number, hash: string) => getBytes(hash).forEach((v, i) => { values[start + i] = `0x${v.toString(16).padStart(2, '0')}`; });
    put(32, COINBASE_SIGNER_ROOT);
    put(64, keccak256(toUtf8Bytes(inputs.scope)));
    // Synthetic witness-shaped response: this test exercises the UI and request
    // policy, while replacing only relay and cryptographic verification boundaries.
    external.wait.mockResolvedValue({ requestId:'market-test', circuit:demo.circuit, status:'completed', proof:'0xabcd1234', publicInputs:values, chainId:84532, verifierAddress:DEMO_VERIFIERS[demo.circuit][84532] });
    return { requestId:'market-test', deepLink:'zkproofport://proof-request?test=1' };
  });
  external.qr.mockResolvedValue('data:image/png;base64,test');
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<CircuitDemo demo={demo} onSelect={() => {}} />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals();
});
function access() { return host.querySelector('.defi-markets')?.getAttribute('data-access'); }
async function receive() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })); });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
}

describe('Markets access follows verification', () => {
  it('shows the received payload, stays locked while checking, and relocks on reset', async () => {
    expect(access()).toBe('locked');
    expect(host.querySelector('.markets-proof-disclosure')).toBeNull();
    await receive();
    expect(access()).toBe('locked');
    const disclosure = host.querySelector('.markets-proof-disclosure')!;
    expect(disclosure.textContent).toContain('4 bytes');
    expect(disclosure.textContent).toContain('128 values');
    expect(disclosure.textContent).toContain('Not included in this proof');
    expect(disclosure.textContent).toContain('does not guarantee wallet anonymity');
    let complete!: (result: { valid:boolean }) => void;
    external.onchain.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    await click('Verify & unlock');
    expect(access()).toBe('locked');
    expect(host.textContent).toContain('Verifying access');
    await act(async () => { complete({ valid:true }); });
    expect(access()).toBe('unlocked');
    expect(host.querySelectorAll('.market-lock .is-open')).toHaveLength(3);
    await click('Start a new demo');
    expect(access()).toBe('locked');
    expect(host.querySelector('.markets-proof-disclosure')).toBeNull();
  });

  it('keeps markets locked when verification rejects a proof and allows a successful retry', async () => {
    await receive();
    external.onchain.mockResolvedValue({ valid:false, error:'Invalid test proof' });
    await click('Verify & unlock');
    expect(access()).toBe('locked');
    expect(host.querySelectorAll('.market-lock .is-open')).toHaveLength(0);
    expect(host.textContent).toContain('Invalid test proof');
    external.onchain.mockResolvedValue({ valid:true });
    await click('Retry verification');
    expect(access()).toBe('unlocked');
  });

  it('ignores a late successful verification after reset', async () => {
    await receive();
    let complete!: (result: { valid:boolean }) => void;
    external.onchain.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    await click('Verify & unlock');
    await act(async () => { (host.querySelector('[aria-label="Reset Markets demo"]') as HTMLButtonElement).click(); });
    await act(async () => { complete({ valid:true }); });
    expect(access()).toBe('locked');
    expect(host.querySelector('.markets-proof-disclosure')).toBeNull();
  });
});
