// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CIRCUIT_IDS } from '@zkproofport-app/sdk';
import CircuitDemo from '../app/components/CircuitDemo';
import { demoById } from '../lib/demo-catalog';
import { cardScope } from '../lib/demo-scopes';
import { DEFAULT_OPTIONS } from '../lib/demo-policy';
import { cardResult } from './fixtures/card-proofs';

/**
 * The Townhall tab (human_passport_score) through the shared credential flow.
 * The relay and cryptographic verification are the boundaries; the hook, the
 * request policy and what it records are real.
 */
const external = vi.hoisted(() => ({ create: vi.fn(), qr: vi.fn(), wait: vi.fn(), onchain: vi.fn(), offchain: vi.fn(), disconnect: vi.fn() }));
vi.mock('../lib/sdk', () => ({
  createSDK: () => ({ createRelayRequest: external.create, generateQRCode: external.qr, waitForProof: external.wait, verifyResponseOffChain: external.offchain, disconnect: external.disconnect }),
  createVerifierSDK: () => ({ verifyResponseOnChain: external.onchain }),
}));

const REQUEST_ID = '0b6f4c1e-8f5a-4d2b-9c3e-7a1d2f3b4c5d';
let host: HTMLDivElement;
let root: Root;

async function render(id: 'passport' | 'country') {
  await act(async () => { root.render(<CircuitDemo demo={demoById(id)!} />); });
}
async function type(selector: string, value: string) {
  const input = host.querySelector(selector) as HTMLInputElement;
  expect(input, selector).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  expect(button, text).toBeTruthy();
  await act(async () => { button!.click(); });
}

function board() {
  const reply = host.querySelector('#passport-reply') as HTMLTextAreaElement;
  const post = [...host.querySelectorAll('.passport-board button')].find(b => b.textContent?.trim() === 'Post reply') as HTMLButtonElement;
  expect(reply, '#passport-reply').toBeTruthy();
  expect(post, 'Post reply').toBeTruthy();
  return { reply, post };
}
async function typeReply(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(board().reply, value); board().reply.dispatchEvent(new Event('input', { bubbles: true })); });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  external.create.mockImplementation(async (circuit, inputs) => {
    const id = circuit === CIRCUIT_IDS.HUMAN_PASSPORT_SCORE ? 'passport' : 'country';
    const options = id === 'passport'
      ? { ...DEFAULT_OPTIONS, minScore: String(inputs.minScore) }
      : { ...DEFAULT_OPTIONS, countries: inputs.countryList.join(','), inclusion: inputs.isIncluded };
    external.wait.mockResolvedValue(cardResult(id, REQUEST_ID, inputs.scope, options));
    return { requestId: REQUEST_ID, deepLink: 'zkproofport://proof-request?test=1' };
  });
  external.qr.mockResolvedValue('data:image/png;base64,test');
  external.onchain.mockResolvedValue({ valid: true });
  external.offchain.mockResolvedValue({ valid: true });
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals();
});

describe('Townhall: a Human Passport score threshold', () => {
  it('shows its own screen and the threshold field, with the default bar', async () => {
    await render('passport');
    expect(host.querySelector('.experience-wordmark')?.textContent).toBe('Townhall');
    expect(host.textContent).toContain('Real people.');
    expect((host.querySelector('#passport-min-score') as HTMLInputElement).value).toBe('20');
    expect(host.textContent).toContain('My Human Passport score ≥ 20');
    // The board stays closed until a proof passes.
    expect(board().reply.disabled).toBe(true);
    expect(board().post.disabled).toBe(true);
    expect(host.textContent).toContain('Posting opens after your proof passes.');
  });

  it('says nothing about counting people, voting once or duplicates', async () => {
    await render('passport');
    const demo = demoById('passport')!;
    const copy = [host.textContent, JSON.stringify(demo)].join(' ');
    for (const banned of [/one vote/i, /\bvot(e|ing|es)\b/i, /one person/i, /per person/i, /choose once/i, /counts? people/i, /nullifier/i, /sybil/i, /duplicate/i, /\bonce\b/i, /ballot/i]) {
      expect(copy, String(banned)).not.toMatch(banned);
    }
  });

  it('requests human_passport_score with its scope and the typed threshold, nothing else', async () => {
    await render('passport');
    await type('#passport-min-score', ' 25.5 ');
    await submit();
    expect(external.create).toHaveBeenCalledTimes(1);
    const [circuit, inputs, options] = external.create.mock.calls[0];
    expect(circuit).toBe('human_passport_score');
    expect(inputs).toEqual({ scope: cardScope('passport'), minScore: 25.5 });
    expect(options).toMatchObject({ dappName: 'Townhall' });
    expect(options).not.toHaveProperty('returnScheme');
    expect(external.qr).toHaveBeenCalledWith('zkproofport://proof-request?test=1', expect.anything());
  });

  it.each(['', '0', '-5', '20.12345', 'abc', '<b>20</b>', '스물'])('refuses threshold %j on screen and sends no request', async value => {
    await render('passport');
    await type('#passport-min-score', value);
    await submit();
    expect(external.create).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/score threshold/);
  });

  it.each([['Onchain', 'onchain'], ['In browser', 'offchain']] as const)('%s verification is told the threshold the request asked for', async (label, path) => {
    await render('passport');
    await type('#passport-min-score', '30');
    await submit();
    expect(host.textContent).toContain('Ready for a private check.');
    await click(label);
    await click('Verify proof');
    const call = path === 'onchain' ? external.onchain.mock.calls[0][2] : external.offchain.mock.calls[0][1];
    expect(call).toEqual({ request: { scope: cardScope('passport'), requestId: REQUEST_ID }, minScore: 30 });
    expect(host.textContent).toContain('Proof accepted.');
    expect(host.textContent).toContain('Above the threshold.');
    expect(board().reply.disabled).toBe(false);
    // Empty and whitespace-only replies cannot be posted.
    expect(board().post.disabled).toBe(true);
    await typeReply('   ');
    expect(board().post.disabled).toBe(true);
    // A reply is shown as text, never as markup.
    await typeReply('  <img src=x onerror=alert(1)> 좋아요 🌱  ');
    expect(board().post.disabled).toBe(false);
    await act(async () => { board().post.click(); });
    const replies = [...host.querySelectorAll('.passport-replies li')];
    expect(replies).toHaveLength(3);
    expect(replies[2].textContent).toBe('You<img src=x onerror=alert(1)> 좋아요 🌱');
    expect(host.querySelector('.passport-replies img')).toBeNull();
    expect(board().reply.value).toBe('');
    expect(host.textContent).toContain('Your reply is on this example board.');
  });

  it('a proof made for a lower threshold than asked is refused before any verify button', async () => {
    await render('passport');
    external.create.mockImplementation(async (_circuit, inputs) => {
      external.wait.mockResolvedValue(cardResult('passport', REQUEST_ID, inputs.scope, { ...DEFAULT_OPTIONS, minScore: '1' }));
      return { requestId: REQUEST_ID, deepLink: 'zkproofport://proof-request?test=1' };
    });
    await submit();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('score threshold');
    expect([...host.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Verify proof')).toBe(false);
  });

  it('a verification the SDK refuses keeps the board closed and offers a retry', async () => {
    await render('passport');
    await submit();
    external.onchain.mockResolvedValue({ valid: false, error: 'The proof is stale.' });
    await click('Verify proof');
    expect(host.textContent).toContain('The proof is stale.');
    expect(host.textContent).not.toContain('Proof accepted.');
    expect(board().reply.disabled).toBe(true);
    expect(board().post.disabled).toBe(true);
  });
});

describe('Borderless: the country condition reaches the fresh verifier SDK', () => {
  it('on-chain verification is told the list and direction the request asked for', async () => {
    await render('country');
    await submit();
    await click('Verify proof');
    expect(external.onchain.mock.calls[0][2]).toEqual({
      request: { scope: cardScope('country'), requestId: REQUEST_ID },
      countryCondition: { countryList: ['KP', 'IR'], isIncluded: false },
    });
  });
});
