// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, TypedDataEncoder } from 'ethers';
import type { RelayProofResult } from '@zkproofport-app/sdk';
import { useSsiatDrop } from '../lib/useSsiatDrop';
import SsiatDemo from '../app/components/SsiatDemo';
import { SSIAT_DROP_ABI } from '../lib/ssiat-drop';
import { claimAction, SSIAT_TEST_DROP, SSIAT_TEST_NULLIFIER, SSIAT_TEST_RECIPIENT, SSIAT_TEST_SCOPE, ssiatResult } from './fixtures/ssiat';

const external = vi.hoisted(() => ({
  dropAddress: '' as string,
  signer: vi.fn(), create: vi.fn(), poll: vi.fn(), qr: vi.fn(), disconnect: vi.fn(),
  getBlockNumber: vi.fn(), destroy: vi.fn(), contracts: [] as string[],
  token: vi.fn(), claimAmount: vi.fn(), remaining: vi.fn(), totalClaims: vi.fn(),
  claimScope: vi.fn(), domainSeparator: vi.fn(), claimActionHash: vi.fn(),
  claimed: vi.fn(), verifyClaim: vi.fn(), claim: vi.fn(), balanceOf: vi.fn(),
}));

// The deployed address is the one thing the tests choose; everything else in
// lib/ssiat-drop.ts is the production code, including the refusal of ''.
vi.mock('../lib/ssiat-drop', async importOriginal => {
  const lib = await importOriginal<typeof import('../lib/ssiat-drop')>();
  return { ...lib, ssiatDropAddress: () => lib.ssiatDropAddress(external.dropAddress) };
});
// Only the relay and RPC boundary are replaced.
vi.mock('@zkproofport-app/sdk', async importOriginal => {
  const sdk = await importOriginal<typeof import('@zkproofport-app/sdk')>();
  return { ...sdk, ProofportSDK: class {
    setSigner = external.signer;
    createRelayRequest = external.create;
    pollResult = external.poll;
    generateQRCode = external.qr;
    disconnect = external.disconnect;
  } };
});
vi.mock('ethers', async importOriginal => {
  const ethers = await importOriginal<typeof import('ethers')>();
  return { ...ethers,
    Wallet: { createRandom: () => new ethers.Wallet('0x' + '01'.repeat(32)) },
    JsonRpcProvider: class { getBlockNumber = external.getBlockNumber; destroy = external.destroy; },
    Contract: class {
      constructor(address: string) { external.contracts.push(address); }
      token = external.token; CLAIM_AMOUNT = external.claimAmount; remaining = external.remaining;
      totalClaims = external.totalClaims; claimScope = external.claimScope; domainSeparator = external.domainSeparator;
      claimActionHash = external.claimActionHash; claimed = external.claimed; verifyClaim = external.verifyClaim;
      claim = external.claim; balanceOf = external.balanceOf;
    },
  };
});

const SEED_TOKEN = '0x3333333333333333333333333333333333333333';
const CLAIM = BigInt('100000000000000000000');
const BOB = '0x0000000000000000000000000000000000000B0B';
const dropErrors = new Interface(SSIAT_DROP_ABI);
const revert = (name: string, args: unknown[] = []) => ({ data: dropErrors.encodeErrorResult(name, args) });

let root: Root;
let host: HTMLDivElement;
let flow: ReturnType<typeof useSsiatDrop>;
function Harness() { flow = useSsiatDrop(); return <output>{flow.phase}:{flow.error}</output>; }
const wallet = () => (window as unknown as { ethereum: { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } }).ethereum;
const listener = (event: string) => wallet().on.mock.calls.find(([name]) => name === event)![1];

function contractAnswersFor(recipient: string) {
  const action = claimAction(recipient);
  external.claimActionHash.mockResolvedValue(TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message));
  external.poll.mockResolvedValue(ssiatResult(SSIAT_TEST_SCOPE, action));
}

beforeEach(async () => {
  vi.resetAllMocks();
  external.contracts.length = 0;
  external.dropAddress = SSIAT_TEST_DROP;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'ethereum', { configurable: true, value: {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [SSIAT_TEST_RECIPIENT];
      if (method === 'eth_chainId') return '0x164ce';
      throw new Error(`Unexpected wallet request: ${method}`);
    }),
    on: vi.fn(), removeListener: vi.fn(),
  } });
  external.getBlockNumber.mockResolvedValue(321);
  external.token.mockResolvedValue(SEED_TOKEN);
  external.claimAmount.mockResolvedValue(CLAIM);
  external.remaining.mockResolvedValue(CLAIM * BigInt(10000));
  external.totalClaims.mockResolvedValue(BigInt(3));
  external.balanceOf.mockResolvedValue(BigInt(0));
  external.claimScope.mockResolvedValue(SSIAT_TEST_SCOPE);
  external.domainSeparator.mockResolvedValue(TypedDataEncoder.hashDomain(claimAction().domain));
  contractAnswersFor(SSIAT_TEST_RECIPIENT);
  external.claimed.mockResolvedValue(false);
  external.verifyClaim.mockResolvedValue(true);
  external.create.mockResolvedValue({ requestId: 'current-request', status: 'pending', deepLink: 'zkproofport://proof-request?data=phone' });
  external.qr.mockResolvedValue('data:image/png;base64,qr');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(<Harness />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  delete (window as Window & { ethereum?: unknown }).ethereum;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function connect() {
  await act(async () => { await flow.connect(); });
  expect(flow.account).toBe(SSIAT_TEST_RECIPIENT);
}
async function proveReady() {
  await connect();
  await act(async () => { await flow.requestProof(); });
  expect(flow.phase).toBe('ready');
}

describe('Ssiat before deployment', () => {
  it('says the drop is not deployed, reads nothing and offers no claim', async () => {
    external.dropAddress = '';
    // The harness mounted in beforeEach read the drop with an address set; start counting here.
    external.remaining.mockClear();
    await act(async () => { root.render(<SsiatDemo />); });
    expect(host.textContent).toContain('Drop not deployed yet');
    expect(host.textContent).toContain('SSIAT_DROP_ADDRESS');
    expect(external.remaining).not.toHaveBeenCalled();
    expect(Array.from(host.querySelectorAll('button')).some(button => /Prove faucet|Claim seeds|Connect recipient/.test(button.textContent ?? ''))).toBe(false);
  });
  it('refuses a proof request without an address instead of using a stand-in', async () => {
    external.dropAddress = '';
    await connect();
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toMatch(/not deployed yet/);
    expect(external.create).not.toHaveBeenCalled();
  });
});

describe('Ssiat page wording', () => {
  it('states testnet, no value, not an official airdrop, and what the proof does and does not show', () => {
    const html = renderToStaticMarkup(<SsiatDemo />);
    expect(html).toContain('Testnet demo');
    expect(html).toContain('SEED has no value');
    expect(html).toContain('not a GIWA, Upbit or Dojang airdrop');
    expect(html).toContain('What the proof shows');
    expect(html).toContain('What it does not show');
    expect(html).toMatch(/mined/);
    expect(html).toContain('씨앗');
    // No third-party logo: only Ssiat's own mark and the ZKProofport proof-provider footer.
    expect(html).not.toMatch(/giwa-logo|upbit-logo/);
  });
});

describe('Ssiat claim orchestration', () => {
  it('requires a connected recipient before any relay request', async () => {
    await act(async () => { await flow.requestProof(); });
    expect(flow.error).toMatch(/Connect the wallet/);
    expect(external.create).not.toHaveBeenCalled();
    await act(async () => { await flow.claim(); });
    expect(external.claim).not.toHaveBeenCalled();
  });

  it('reads the drop at one block, sends the exact scope and Claim(recipient), and preflights the returned proof', async () => {
    await proveReady();
    for (const read of [external.claimScope, external.domainSeparator, external.remaining, external.claimAmount]) {
      expect(read).toHaveBeenCalledWith({ blockTag: 321 });
    }
    expect(external.claimActionHash).toHaveBeenCalledWith(SSIAT_TEST_RECIPIENT, { blockTag: 321 });
    expect(external.signer.mock.invocationCallOrder[0]).toBeLessThan(external.create.mock.invocationCallOrder[0]);
    expect(external.create).toHaveBeenCalledWith('dojang_playground', { scope: SSIAT_TEST_SCOPE, action: claimAction() }, expect.objectContaining({ dappName: 'Ssiat' }));
    expect(external.claimed).toHaveBeenCalledWith(SSIAT_TEST_NULLIFIER);
    expect(external.verifyClaim).toHaveBeenCalledWith(SSIAT_TEST_RECIPIENT, '0x1234', expect.any(Array));
    expect(external.verifyClaim.mock.calls[0][2]).toHaveLength(160);
    expect(flow.proof).toMatchObject({ recipient: SSIAT_TEST_RECIPIENT, nullifier: SSIAT_TEST_NULLIFIER, amount: CLAIM });
    expect(external.contracts.every(address => address === SSIAT_TEST_DROP || address === SEED_TOKEN)).toBe(true);
  });

  it('claims for the connected recipient and reports the confirmed transaction', async () => {
    await proveReady();
    const hash = '0x' + '12'.repeat(32);
    external.claim.mockResolvedValue({ hash, wait: async () => ({ hash, status: 1 }) });
    await act(async () => { await flow.claim(); });
    expect(external.claim).toHaveBeenCalledWith(SSIAT_TEST_RECIPIENT, '0x1234', expect.any(Array), { chainId: 91342 });
    expect(flow.phase).toBe('claimed');
    expect(flow.receipt).toEqual({ hash, amount: CLAIM, recipient: SSIAT_TEST_RECIPIENT });
    expect(flow.proof).toBeNull();
  });

  it('shows an already-used faucet wallet as its own state, before any transaction', async () => {
    await connect();
    external.claimed.mockResolvedValue(true);
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('already-claimed');
    expect(flow.error).toBe('');
    expect(flow.proof).toBeNull();
    expect(external.verifyClaim).not.toHaveBeenCalled();
  });

  it('turns an AlreadyClaimed preflight revert (a claim that landed meanwhile) into the same state', async () => {
    await connect();
    external.verifyClaim.mockRejectedValue(revert('AlreadyClaimed', [SSIAT_TEST_NULLIFIER]));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('already-claimed');
    expect(flow.proof).toBeNull();
  });

  it('turns an AlreadyClaimed claim revert into that state and drops the proof', async () => {
    await proveReady();
    external.claim.mockRejectedValue(revert('AlreadyClaimed', [SSIAT_TEST_NULLIFIER]));
    await act(async () => { await flow.claim(); });
    expect(flow.phase).toBe('already-claimed');
    expect(flow.proof).toBeNull();
  });

  it.each([
    ['equal to one claim', CLAIM, true], ['one unit short', CLAIM - BigInt(1), false], ['empty', BigInt(0), false],
  ])('with the pool %s, %s a relay request', async (_, remaining, proceeds) => {
    await connect();
    external.remaining.mockResolvedValue(remaining);
    await act(async () => { await flow.requestProof(); });
    expect(external.create).toHaveBeenCalledTimes(proceeds ? 1 : 0);
    expect(flow.phase).toBe(proceeds ? 'ready' : 'exhausted');
  });

  it('reports an emptied pool from the claim revert', async () => {
    await proveReady();
    external.claim.mockRejectedValue(revert('DropExhausted'));
    await act(async () => { await flow.claim(); });
    expect(flow.phase).toBe('exhausted');
  });

  it('refuses a proof signed for another recipient before calling the contract', async () => {
    await connect();
    external.poll.mockResolvedValue(ssiatResult(SSIAT_TEST_SCOPE, claimAction(BOB)));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toMatch(/different recipient/);
    expect(external.claimed).not.toHaveBeenCalled();
    expect(external.verifyClaim).not.toHaveBeenCalled();
  });

  it('refuses an identity-only proof before calling the contract', async () => {
    await connect();
    external.poll.mockResolvedValue(ssiatResult(SSIAT_TEST_SCOPE));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(external.verifyClaim).not.toHaveBeenCalled();
  });

  it.each([
    ['a different scope', () => external.claimScope.mockResolvedValue('ssiat-drop:v1:' + 'cd'.repeat(32))],
    ['a malformed scope', () => external.claimScope.mockResolvedValue('<script>')],
    ['a different domain', () => external.domainSeparator.mockResolvedValue('0x' + '00'.repeat(32))],
    ['a different action hash', () => external.claimActionHash.mockResolvedValue('0x' + '00'.repeat(32))],
  ])('stops before the relay when the configured contract returns %s', async (_, arrange) => {
    await connect();
    arrange();
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toMatch(/not the Ssiat drop/);
    expect(external.create).not.toHaveBeenCalled();
  });

  it('surfaces an RPC failure without a relay request', async () => {
    await connect();
    external.getBlockNumber.mockRejectedValue(new Error('RPC unavailable'));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toContain('RPC unavailable');
    expect(external.create).not.toHaveBeenCalled();
  });

  it('surfaces a relay failure to create the request', async () => {
    await connect();
    external.create.mockRejectedValue(new Error('Relay refused the request'));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toContain('Relay refused');
  });

  it('keeps the proof after a declined wallet prompt, so the claim can be retried', async () => {
    await proveReady();
    external.claim.mockRejectedValue({ code: 'ACTION_REJECTED' });
    await act(async () => { await flow.claim(); });
    expect(flow.phase).toBe('ready');
    expect(flow.error).toMatch(/declined/);
    expect(flow.proof).not.toBeNull();
  });

  it.each(['InvalidProof', 'WrongClaimAction', 'WrongClaimScope', 'WrongClaimDomain'])('drops the proof when the claim reverts with %s', async name => {
    await proveReady();
    external.claim.mockRejectedValue(revert(name));
    await act(async () => { await flow.claim(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.proof).toBeNull();
  });

  it('does not report a reverted receipt as a claim', async () => {
    await proveReady();
    const hash = '0x' + '34'.repeat(32);
    external.claim.mockResolvedValue({ hash, wait: async () => ({ hash, status: 0 }) });
    await act(async () => { await flow.claim(); });
    expect(flow.phase).not.toBe('claimed');
    expect(flow.receipt).toBeNull();
    expect(flow.error).toMatch(/not confirmed/);
  });

  it('refuses to send when the wallet silently switched account after proving', async () => {
    await proveReady();
    wallet().request.mockImplementation(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x164ce' : [BOB]);
    await act(async () => { await flow.claim(); });
    expect(flow.error).toMatch(/Reconnect/);
    expect(external.claim).not.toHaveBeenCalled();
  });

  it('creates only one relay request for repeated clicks', async () => {
    await connect();
    external.poll.mockImplementation(() => new Promise(() => {}));
    await act(async () => { void flow.requestProof(); void flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    expect(external.create).toHaveBeenCalledOnce();
  });
});

describe('Ssiat races: a late answer never revives a voided request', () => {
  it.each(['accountsChanged', 'chainChanged'])('discards a pending proof after %s, including its late relay result', async event => {
    await connect();
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    await act(async () => { listener(event)(event === 'chainChanged' ? '0x1' : []); });
    expect(flow.account).toBe('');
    expect(flow.qr).toBe('');
    expect(flow.error).toMatch(/Wallet or network changed/);
    await act(async () => { complete(ssiatResult(SSIAT_TEST_SCOPE, claimAction())); await requesting; });
    expect(flow.phase).toBe('idle');
    expect(flow.proof).toBeNull();
    expect(external.verifyClaim).not.toHaveBeenCalled();
  });

  it.each(['accountsChanged', 'chainChanged'])('voids an accepted proof on %s, so no claim can be sent with it', async event => {
    await proveReady();
    await act(async () => { listener(event)([]); });
    expect(flow.proof).toBeNull();
    await act(async () => { await flow.claim(); });
    expect(external.claim).not.toHaveBeenCalled();
  });

  it('ignores the receipt of a claim whose wallet changed while it was mining', async () => {
    await proveReady();
    let mine!: (receipt: { hash: string; status: number }) => void;
    const hash = '0x' + '56'.repeat(32);
    external.claim.mockResolvedValue({ hash, wait: () => new Promise(resolve => { mine = resolve; }) });
    let claiming!: Promise<void>;
    await act(async () => { claiming = flow.claim(); await vi.waitFor(() => expect(mine).toBeTypeOf('function')); });
    await act(async () => { listener('accountsChanged')([]); });
    await act(async () => { mine({ hash, status: 1 }); await claiming; });
    expect(flow.phase).toBe('idle');
    expect(flow.receipt).toBeNull();
  });

  it('discards a late proof after the user cancels', async () => {
    await connect();
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    await act(async () => { flow.reset(); complete(ssiatResult(SSIAT_TEST_SCOPE, claimAction())); await requesting; });
    expect(flow.phase).toBe('idle');
    expect(flow.proof).toBeNull();
    expect(external.claimed).not.toHaveBeenCalled();
  });

  it('does not act on a late proof after the tab unmounts', async () => {
    await connect();
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    await act(async () => { root.render(null); });
    await act(async () => { complete(ssiatResult(SSIAT_TEST_SCOPE, claimAction())); await requesting; });
    expect(external.verifyClaim).not.toHaveBeenCalled();
  });
});

describe('Ssiat relay endings go through settleRelayResult', () => {
  it.each([
    [{ status: 'cancelled' }, 'ended', /declined in the ZKProofport app/],
    [{ status: 'expired', error: 'deadline' }, 'ended', /did not answer in time/],
    [{ status: 'error', error: 'No Playground issuance found', errorCode: 'E2007' }, 'blocked', /No Playground issuance found \(error code E2007\)/],
    [{ status: 'failed', error: 'Proof generation failed' }, 'blocked', /Proof generation failed/],
    [{ status: 'approved' }, 'blocked', /unknown status 'approved'/],
  ])('stops polling on %j', async (answer, phase, message) => {
    await connect();
    external.poll.mockResolvedValueOnce({ requestId: 'current-request', status: 'pending' })
      .mockResolvedValueOnce({ requestId: 'current-request', status: 'generating' })
      .mockResolvedValue({ requestId: 'current-request', circuit: 'dojang_playground', ...answer });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(4_100); await requesting; });
    expect(external.poll).toHaveBeenCalledTimes(3);
    expect(flow.phase).toBe(phase);
    expect(phase === 'ended' ? flow.notice : flow.error).toMatch(message);
    expect(phase === 'ended' ? flow.error : flow.notice).toBe('');
    expect(flow.proof).toBeNull();
    expect(external.verifyClaim).not.toHaveBeenCalled();
  });
});

describe('Ssiat through the page', () => {
  it.each([false, true])('connects, shows the QR or app link, then claims (mobile=%s)', async mobile => {
    if (mobile) vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    const hash = '0x' + '78'.repeat(32);
    external.claim.mockResolvedValue({ hash, wait: async () => ({ hash, status: 1 }) });
    await act(async () => { root.render(<SsiatDemo />); });
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label);
    await act(async () => { button('Connect recipient wallet')!.click(); });
    await act(async () => { button('Prove faucet participation')!.click(); });
    const qr = host.querySelector('img[alt="Scan with ZKProofport to prove faucet participation for this claim"]');
    if (mobile) expect(qr).toBeNull();
    else expect(qr?.getAttribute('src')).toBe('data:image/png;base64,qr');
    expect(host.querySelector('a[href="zkproofport://proof-request?data=phone"]')).not.toBeNull();
    await act(async () => { complete(ssiatResult(SSIAT_TEST_SCOPE, claimAction())); });
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain('Proof accepted by the drop'); });
    await act(async () => { button('Claim seeds')!.click(); });
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain('Seeds claimed'); });
    expect(host.querySelector(`a[href$="/tx/${hash}"]`)).not.toBeNull();
  });

  it('shows a decline as a neutral ending with Try again, not as an error', async () => {
    external.poll.mockResolvedValue({ requestId: 'current-request', status: 'cancelled' });
    await act(async () => { root.render(<SsiatDemo />); });
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label);
    await act(async () => { button('Connect recipient wallet')!.click(); });
    await act(async () => { button('Prove faucet participation')!.click(); });
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain('Request ended'); });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button('Try again')).toBeDefined();
  });

  it('shows the already-claimed state with no claim button', async () => {
    external.claimed.mockResolvedValue(true);
    await act(async () => { root.render(<SsiatDemo />); });
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label);
    await act(async () => { button('Connect recipient wallet')!.click(); });
    await act(async () => { button('Prove faucet participation')!.click(); });
    await vi.waitFor(async () => { await act(async () => {}); expect(host.textContent).toContain('Already claimed'); });
    expect(button('Claim seeds')).toBeUndefined();
  });

  it('shows UTF-8 relay error text intact', async () => {
    external.poll.mockResolvedValue({ requestId: 'current-request', status: 'error', error: '발급 기록을 찾을 수 없습니다 🌱 <b>x</b>' });
    await act(async () => { root.render(<SsiatDemo />); });
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label);
    await act(async () => { button('Connect recipient wallet')!.click(); });
    await act(async () => { button('Prove faucet participation')!.click(); });
    await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('[role="alert"]')?.textContent).toContain('발급 기록을 찾을 수 없습니다 🌱 <b>x</b>'); });
    expect(host.querySelector('[role="alert"] b')).toBeNull();
  });
});
