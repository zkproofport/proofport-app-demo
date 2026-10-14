// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import LandingPage from '../app/page';
import { DECLINED_MESSAGE, DEMO_PROOF_WAIT_MS, EXPIRED_MESSAGE, NO_RELAY_ANSWER_MESSAGE } from '../lib/relay-outcome';

/**
 * The "All demos" page (app/page.tsx) has its own five request handlers. Each
 * one used to handle only `completed` and `failed`, so an `error`, `cancelled`
 * or `expired` answer left the modal on "Waiting for proof..." forever.
 */
const external = vi.hoisted(() => ({ create: vi.fn(), qr: vi.fn(), wait: vi.fn(), signer: vi.fn(), disconnect: vi.fn() }));
vi.mock('../lib/sdk', () => ({ createSDK: () => ({ setSigner: external.signer, createRelayRequest: external.create, generateQRCode: external.qr, waitForProof: external.wait, disconnect: external.disconnect }) }));
// The tab shell is covered elsewhere (and touches link.sizes, which jsdom lacks); the cards are what is tested here.
vi.mock('../app/components/DemoTabs', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('ethers', async importOriginal => {
  const ethers = await importOriginal<typeof import('ethers')>();
  // jsdom and Node crypto disagree on Uint8Array realms for random wallets; a fixed key is enough here.
  return { ...ethers, ethers: { ...ethers.ethers, Wallet: { createRandom: () => new ethers.Wallet('0x' + '01'.repeat(32)) } } };
});

let host: HTMLDivElement;
let root: Root;
async function mount() {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  external.create.mockResolvedValue({ requestId: 'req-all', deepLink: 'zkproofport://proof-request?test=1' });
  external.qr.mockResolvedValue('data:image/png;base64,test');
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<LandingPage />); });
}
async function unmount() {
  await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals();
}

type Card = 'kyc' | 'country' | 'email' | 'mdl' | 'giwa';
const CARDS: Card[] = ['kyc', 'country', 'email', 'mdl', 'giwa'];

async function request(card: Card) {
  const button = [...host.querySelectorAll(`#demo-${card} button`)].find(b => b.textContent?.includes('Request Proof') || b.textContent?.includes('Request')) as HTMLButtonElement;
  expect(button, `no request button on ${card}`).toBeTruthy();
  await act(async () => { button.click(); });
}
const ending = () => host.querySelector('[data-ending]');
const waiting = () => host.textContent!.includes('Waiting for proof...');

describe('every card on the All demos page ends on the relay’s answer', () => {
  beforeEach(mount);
  afterEach(unmount);
  for (const card of CARDS) {
    it(`${card}: cancelled shows the decline, neutral, with Try again`, async () => {
      external.wait.mockResolvedValue({ requestId: 'req-all', status: 'cancelled', proof: '0xabcd' });
      await request(card);
      expect(external.wait).toHaveBeenCalledWith('req-all', { timeoutMs: DEMO_PROOF_WAIT_MS });
      expect(ending()!.getAttribute('data-ending')).toBe('declined');
      expect(ending()!.getAttribute('role')).toBe('status');
      expect(ending()!.textContent).toContain('Request Declined');
      expect(ending()!.textContent).toContain(DECLINED_MESSAGE);
      expect(ending()!.textContent).not.toContain('Proof Failed');
      expect(host.textContent).not.toContain('Proof Received');
      expect(waiting()).toBe(false);
    });

    it(`${card}: error shows the message and the error code`, async () => {
      external.wait.mockResolvedValue({ requestId: 'req-all', status: 'error', error: 'No attestation found', errorCode: 'E2005' });
      await request(card);
      expect(ending()!.getAttribute('data-ending')).toBe('error');
      expect(ending()!.getAttribute('role')).toBe('alert');
      expect(ending()!.textContent).toContain('Proof Failed');
      expect(ending()!.textContent).toContain('No attestation found');
      expect(ending()!.textContent).toContain('Error code E2005');
      expect(waiting()).toBe(false);
    });

    it(`${card}: expired shows the timeout ending`, async () => {
      external.wait.mockResolvedValue({ requestId: 'req-all', status: 'expired', error: 'The request timed out before the app answered' });
      await request(card);
      expect(ending()!.getAttribute('data-ending')).toBe('expired');
      expect(ending()!.textContent).toContain('Request Expired');
      expect(ending()!.textContent).toContain(EXPIRED_MESSAGE);
      expect(waiting()).toBe(false);
    });

    it(`${card}: an unknown status is an error that names it`, async () => {
      external.wait.mockResolvedValue({ requestId: 'req-all', status: 'approved', proof: '0xabcd' });
      await request(card);
      expect(ending()!.getAttribute('data-ending')).toBe('error');
      expect(ending()!.textContent).toContain("unknown status 'approved'");
      expect(host.textContent).not.toContain('Proof Received');
    });
  }

  it('legacy failed is still an error', async () => {
    external.wait.mockResolvedValue({ requestId: 'req-all', status: 'failed', error: 'Proof generation failed' });
    await request('kyc');
    expect(ending()!.getAttribute('data-ending')).toBe('error');
    expect(ending()!.textContent).toContain('Proof generation failed');
    expect(ending()!.textContent).not.toContain('Error code');
  });

  it('the SDK’s own timeout shows the no-relay-answer fallback (the old check for "timeout" never matched it)', async () => {
    external.wait.mockRejectedValue(new Error(`Waiting for proof timed out after ${DEMO_PROOF_WAIT_MS}ms`));
    await request('kyc');
    expect(ending()!.getAttribute('data-ending')).toBe('expired');
    expect(ending()!.textContent).toContain(NO_RELAY_ANSWER_MESSAGE);
  });

  it('a failure to create the request is shown instead of leaving the modal blank', async () => {
    external.create.mockRejectedValue(new Error('Relay refused the request'));
    await request('kyc');
    expect(ending()!.getAttribute('data-ending')).toBe('error');
    expect(ending()!.textContent).toContain('Relay refused the request');
  });

  it.each([['0'], ['151'], ['1.5'], [''], ['   ']])('an mDL age threshold of %j fails before any request, with no request panel', async (value) => {
    const input = host.querySelector('#demo-mdl input[type="number"], #demo-mdl input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await request('mdl');
    expect(external.create).not.toHaveBeenCalled();
    expect(ending()!.getAttribute('data-ending')).toBe('error');
    expect(ending()!.textContent).toContain('Age threshold must be an integer between 1 and 150.');
    expect(host.textContent).not.toContain('Request Generated');
  });

  it('a new request clears the previous request’s QR', async () => {
    external.wait.mockResolvedValue({ requestId: 'req-all', status: 'cancelled' });
    await request('kyc');
    expect(host.querySelector('img[alt="QR Code"]')).not.toBeNull();
    external.create.mockRejectedValue(new Error('Relay refused the request'));
    const retry = [...ending()!.querySelectorAll('button')].find(b => b.textContent === 'Try again')!;
    await act(async () => { retry.click(); });
    expect(host.querySelector('img[alt="QR Code"]')).toBeNull();
    expect(ending()!.textContent).toContain('Relay refused the request');
  });

  it('Try again starts a new request for the same card', async () => {
    external.wait.mockResolvedValue({ requestId: 'req-all', status: 'cancelled' });
    await request('country');
    const retry = [...ending()!.querySelectorAll('button')].find(b => b.textContent === 'Try again')!;
    external.wait.mockResolvedValue({ requestId: 'req-all', status: 'error', error: 'second', errorCode: 'E2007' });
    await act(async () => { retry.click(); });
    expect(external.create).toHaveBeenCalledTimes(2);
    expect(external.create.mock.calls[1][0]).toBe(external.create.mock.calls[0][0]);
    expect(ending()!.textContent).toContain('Error code E2007');
  });

  it('a completed answer still shows the proof', async () => {
    external.wait.mockResolvedValue({ requestId: 'req-all', status: 'completed', proof: '0xabcd', publicInputs: ['0x01'] });
    await request('kyc');
    expect(ending()).toBeNull();
    expect(host.textContent).toContain('Proof Received');
  });
});

describe('source: every wait goes through the shared handler', () => {
  const sources = ['app/page.tsx', 'lib/useCredentialDemo.ts', 'lib/useGiwaVault.ts'].map(file => [file, readFileSync(join(process.cwd(), file), 'utf-8')] as const);

  it('no wait names its own number of milliseconds', () => {
    for (const [file, source] of sources) {
      expect(source, file).not.toMatch(/timeoutMs:\s*\d/);
      expect(source, file).not.toMatch(/\b180000\b|\b180_000\b/);
    }
  });

  it('each waitForProof in app/page.tsx is handed to applyRelayResult', () => {
    const page = sources[0][1];
    const waits = page.match(/= await sdk\.waitForProof\(result\.requestId, \{ timeoutMs: DEMO_PROOF_WAIT_MS \}\);\n\s*applyRelayResult\('\w+', finalResult\);/g) ?? [];
    expect(waits).toHaveLength(5);
    // The visitor snippet is the only other mention.
    expect(page.match(/sdk\.waitForProof\(/g)).toHaveLength(5);
  });
});
