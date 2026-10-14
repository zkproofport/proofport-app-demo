// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CircuitDemo from '../app/components/CircuitDemo';
import { demoById } from '../lib/demo-catalog';
import { DECLINED_MESSAGE, DEMO_PROOF_WAIT_MS, EXPIRED_MESSAGE, NO_RELAY_ANSWER_MESSAGE } from '../lib/relay-outcome';

/**
 * Every way a relay request can end, through the hook every credential tab
 * shares (useCredentialDemo) and the panel that renders it. Only the SDK
 * boundary is replaced; the outcome handling, React state and panel are real.
 */
const external = vi.hoisted(() => ({ create: vi.fn(), qr: vi.fn(), wait: vi.fn(), disconnect: vi.fn(), prepare: vi.fn() }));
vi.mock('../lib/sdk', () => ({ createSDK: () => ({ createRelayRequest: external.create, generateQRCode: external.qr, waitForProof: external.wait, disconnect: external.disconnect }) }));
// Spy on the proof policy without changing it, so "a cancel is never processed as a proof" is observable.
vi.mock('../lib/demo-policy', async importOriginal => {
  const real = await importOriginal<typeof import('../lib/demo-policy')>();
  external.prepare.mockImplementation(real.prepareDemoProof);
  return { ...real, prepareDemoProof: external.prepare };
});

const demo = demoById('kyc')!;
let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  external.create.mockResolvedValue({ requestId: 'req-1', deepLink: 'zkproofport://proof-request?test=1' });
  external.qr.mockResolvedValue('data:image/png;base64,test');
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<CircuitDemo demo={demo} onSelect={() => {}} />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals();
});

const panel = () => host.querySelector('.proof-panel')!;
const phase = () => panel().getAttribute('data-phase');
async function submit() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
async function endWith(answer: Record<string, unknown>) {
  external.wait.mockResolvedValue({ requestId: 'req-1', circuit: demo.circuit, ...answer });
  await submit();
}

describe('a credential demo shows how its request ended', () => {
  it('waits with the shared deadline, which outlasts the relay', async () => {
    await endWith({ status: 'cancelled' });
    expect(external.wait).toHaveBeenCalledWith('req-1', { timeoutMs: DEMO_PROOF_WAIT_MS });
  });

  it('cancelled: a neutral decline, not an error, never processed as a proof, and offers to try again', async () => {
    await endWith({ status: 'cancelled', error: 'User cancelled the request', proof: '0xabcd' });
    expect(phase()).toBe('declined');
    expect(panel().querySelector('[role="status"]')!.textContent).toBe('Request declined');
    expect(panel().querySelector('.proof-notice')!.textContent).toBe(DECLINED_MESSAGE);
    expect(panel().querySelector('.proof-error')).toBeNull();
    expect(external.prepare).not.toHaveBeenCalled();
    expect(host.querySelector('.demo-receipt')).toBeNull();
    const retry = panel().querySelector('button.proof-primary')!;
    expect(retry.textContent).toContain('Try again');
    external.wait.mockResolvedValue({ requestId: 'req-1', circuit: demo.circuit, status: 'expired' });
    await submit();
    expect(external.create).toHaveBeenCalledTimes(2);
    expect(phase()).toBe('expired');
  });

  it('error: the app message and its error code', async () => {
    await endWith({ status: 'error', error: 'No attestation found', errorCode: 'E2005' });
    expect(phase()).toBe('error');
    const error = panel().querySelector('.proof-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('No attestation found');
    expect(error.querySelector('.proof-error-code')!.textContent).toBe('Error code E2005');
    expect(panel().querySelector('.proof-notice')).toBeNull();
    expect(external.prepare).not.toHaveBeenCalled();
    expect(panel().querySelector('button.proof-primary')!.textContent).toContain('Try again');
  });

  it('error without a code shows no code line', async () => {
    await endWith({ status: 'error', error: 'Sign-in refused' });
    expect(panel().querySelector('.proof-error')!.textContent).toBe('Sign-in refused');
    expect(panel().querySelector('.proof-error-code')).toBeNull();
  });

  it('legacy failed is shown as an error', async () => {
    await endWith({ status: 'failed', error: 'Proof generation failed' });
    expect(phase()).toBe('error');
    expect(panel().querySelector('.proof-error')!.textContent).toBe('Proof generation failed');
  });

  it('expired: the timeout ending, neutral', async () => {
    await endWith({ status: 'expired', error: 'The request timed out before the app answered' });
    expect(phase()).toBe('expired');
    expect(panel().querySelector('.proof-notice')!.textContent).toBe(EXPIRED_MESSAGE);
    expect(panel().querySelector('.proof-error')).toBeNull();
  });

  it('an unknown status is an explicit error naming it, never a proof', async () => {
    await endWith({ status: 'approved', proof: '0xabcd' });
    expect(phase()).toBe('error');
    expect(panel().querySelector('.proof-error')!.textContent).toContain("unknown status 'approved'");
    expect(external.prepare).not.toHaveBeenCalled();
  });

  it('the SDK’s own timeout (no relay answer) falls back to the expired ending', async () => {
    external.wait.mockRejectedValue(new Error(`Waiting for proof timed out after ${DEMO_PROOF_WAIT_MS}ms`));
    await submit();
    expect(phase()).toBe('expired');
    expect(panel().querySelector('.proof-notice')!.textContent).toBe(NO_RELAY_ANSWER_MESSAGE);
  });

  it('any other rejection is shown as it is', async () => {
    external.wait.mockRejectedValue(new Error('xhr poll error'));
    await submit();
    expect(phase()).toBe('error');
    expect(panel().querySelector('.proof-error')!.textContent).toBe('xhr poll error');
  });

  it('markup in the app message and code is shown as text', async () => {
    await endWith({ status: 'error', error: '<img src=x onerror="window.__xss=1">실패 🙏', errorCode: '<b>E2005</b>' });
    expect(panel().querySelector('.proof-error img, .proof-error b')).toBeNull();
    expect(panel().querySelector('.proof-error')!.textContent).toContain('<img src=x onerror="window.__xss=1">실패 🙏');
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('a completed result still goes through the proof policy', async () => {
    await endWith({ status: 'completed', proof: '0xabcd', publicInputs: [] });
    expect(external.prepare).toHaveBeenCalledTimes(1);
    // The fixture is not a valid proof, so the policy refuses it — as an error, not a decline.
    expect(phase()).toBe('error');
  });

  it('a cancel that arrives after the visitor reset is ignored', async () => {
    let answer!: (value: unknown) => void;
    external.wait.mockReturnValue(new Promise(resolve => { answer = resolve; }));
    await submit();
    expect(phase()).toBe('waiting');
    await act(async () => { (panel().querySelector('[aria-label="Reset Markets demo"]') as HTMLButtonElement).click(); });
    await act(async () => { answer({ requestId: 'req-1', circuit: demo.circuit, status: 'cancelled' }); });
    expect(phase()).toBe('idle');
    expect(panel().querySelector('.proof-notice')).toBeNull();
  });

  it('the waiting screen no longer promises a 3-minute expiry', async () => {
    external.wait.mockReturnValue(new Promise(() => {}));
    await submit();
    expect(panel().textContent).not.toContain('3 minutes');
    expect(panel().textContent).toContain('under 5 minutes');
  });
});
