// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBytes, keccak256, toUtf8Bytes } from 'ethers';
import CircuitDemo from '../app/components/CircuitDemo';
import { demoById } from '../lib/demo-catalog';
import { DEMO_VERIFIERS } from '../lib/demo-policy';
import { cardScope } from '../lib/demo-scopes';

// The relay answers only at the network boundary; the hook, the demo policy and
// the request it records are real. Verification is the other boundary: the
// test reads what the hook hands to the SDK.
const external = vi.hoisted(() => ({ create: vi.fn(), qr: vi.fn(), wait: vi.fn(), onchain: vi.fn(), offchain: vi.fn(), disconnect: vi.fn() }));
vi.mock('../lib/sdk', () => ({
  createSDK: () => ({ createRelayRequest: external.create, generateQRCode: external.qr, waitForProof: external.wait, verifyResponseOffChain: external.offchain, disconnect: external.disconnect }),
  createVerifierSDK: () => ({ verifyResponseOnChain: external.onchain }),
}));

const REQUEST_ID = '0b6f4c1e-8f5a-4d2b-9c3e-7a1d2f3b4c5d';
const field = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const demo = demoById('email')!;

/** A 214-input response that passes the demo's own policy for the default domain and provider. */
function emailResult(requestId: string, scope: string) {
  const values = Array.from({ length: 214 }, () => field(0));
  const put = (start: number, bytes: Uint8Array) => bytes.forEach((v, i) => { values[start + i] = field(v); });
  const domain = toUtf8Bytes('zkproofport.com');
  put(18, domain); values[82] = field(domain.length);
  put(83, getBytes(keccak256(toUtf8Bytes(scope))));
  return { requestId, circuit: demo.circuit, status: 'completed', proof: '0xabcd1234', publicInputs: values, chainId: 84532, verifierAddress: DEMO_VERIFIERS[demo.circuit][84532] };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  external.create.mockImplementation(async (_circuit, inputs) => {
    external.wait.mockResolvedValue(emailResult(REQUEST_ID, inputs.scope));
    return { requestId: REQUEST_ID, deepLink: 'zkproofport://proof-request?test=1' };
  });
  external.qr.mockResolvedValue('data:image/png;base64,test');
  external.onchain.mockResolvedValue({ valid: true });
  external.offchain.mockResolvedValue({ valid: true });
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<CircuitDemo demo={demo} onSelect={() => {}} />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals();
});

async function receive() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  expect(button, text).toBeTruthy();
  await act(async () => { button!.click(); });
}

describe('every verification names the relay request the proof answers', () => {
  it('on-chain: the fresh verifier SDK gets { scope, requestId } of the request this tab created', async () => {
    await receive();
    await click('Verify proof');
    expect(external.onchain).toHaveBeenCalledTimes(1);
    const [response, provider, options] = external.onchain.mock.calls[0];
    expect(response).toMatchObject({ requestId: REQUEST_ID, circuit: 'oidc_domain_attestation' });
    expect(provider).toBeUndefined();
    expect(options).toEqual({ request: { scope: cardScope('email'), requestId: REQUEST_ID } });
    expect(host.textContent).toContain('Proof accepted.');
  });

  it('in browser: the off-chain verify gets the same request', async () => {
    await receive();
    await click('In browser');
    await click('Verify proof');
    expect(external.offchain).toHaveBeenCalledTimes(1);
    expect(external.offchain.mock.calls[0][1]).toEqual({ request: { scope: cardScope('email'), requestId: REQUEST_ID } });
    expect(external.onchain).not.toHaveBeenCalled();
  });

  it('a new request replaces the recorded one: verification never carries a previous attempt', async () => {
    await receive();
    const second = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    external.create.mockImplementation(async (_circuit, inputs) => {
      external.wait.mockResolvedValue(emailResult(second, inputs.scope));
      return { requestId: second, deepLink: 'zkproofport://proof-request?test=2' };
    });
    const reset = host.querySelector('[aria-label^="Reset "]') as HTMLButtonElement | null;
    expect(reset).toBeTruthy();
    await act(async () => { reset!.click(); });
    await receive();
    await click('Verify proof');
    const options = external.onchain.mock.calls.at(-1)![2];
    expect(options.request.requestId).toBe(second);
  });
});
