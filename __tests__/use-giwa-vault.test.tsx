// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypedDataEncoder } from 'ethers';
import type { RelayProofResult } from '@zkproofport-app/sdk';
import { useGiwaVault } from '../lib/useGiwaVault';
import GiwaDemo from '../app/components/GiwaDemo';
import { OPERATIONAL_WALLET, TOKEN_ADDRESS, VAULT_ADDRESS } from '../lib/giwa-vault';
import { depositAction, giwaResult } from './fixtures/giwa';

const external = vi.hoisted(() => ({
  signer: vi.fn(), create: vi.fn(), poll: vi.fn(), qr: vi.fn(), disconnect: vi.fn(),
  getBlockNumber: vi.fn(), depositScope: vi.fn(), nonces: vi.fn(), domainSeparator: vi.fn(),
  depositActionHash: vi.fn(), verifyEligibility: vi.fn(), balanceOf: vi.fn(),
  totalDeposits: vi.fn(), allowance: vi.fn(), destroy: vi.fn(),
  offchain: vi.fn(), onchain: vi.fn(), approve: vi.fn(), deposit: vi.fn(), withdraw: vi.fn(),
}));

// Only the relay and RPC boundary are replaced. React state, wallet connection,
// action construction and the returned-proof policy are the production code.
vi.mock('@zkproofport-app/sdk', async importOriginal => {
  const sdk = await importOriginal<typeof import('@zkproofport-app/sdk')>();
  return { ...sdk, ProofportSDK: class {
    setSigner = external.signer;
    createRelayRequest = external.create;
    pollResult = external.poll;
    generateQRCode = external.qr;
    disconnect = external.disconnect;
    verifyResponseOffChain = external.offchain;
    verifyResponseOnChain = external.onchain;
  } };
});
vi.mock('ethers', async importOriginal => {
  const ethers = await importOriginal<typeof import('ethers')>();
  return { ...ethers,
    // jsdom and Node crypto have different Uint8Array realms; mnemonic
    // generation receives a Node Buffer that ethers rejects in jsdom. A real
    // fixed test wallet keeps signing behavior available without random seeds.
    Wallet: { createRandom: () => new ethers.Wallet('0x' + '01'.repeat(32)) },
    JsonRpcProvider: class { getBlockNumber = external.getBlockNumber; destroy = external.destroy; },
    Contract: class {
      depositScope = external.depositScope;
      nonces = external.nonces;
      domainSeparator = external.domainSeparator;
      depositActionHash = external.depositActionHash;
      verifyEligibility = external.verifyEligibility;
      balanceOf = external.balanceOf;
      totalDeposits = external.totalDeposits;
      allowance = external.allowance;
      approve = external.approve;
      deposit = external.deposit;
      withdraw = external.withdraw;
    },
  };
});

const scope = 'giwa-vault:v1:' + 'ab'.repeat(32);
function expectedAction() {
  const action = depositAction();
  action.domain.verifyingContract = VAULT_ADDRESS;
  action.message = { account: OPERATIONAL_WALLET, asset: TOKEN_ADDRESS, amount: '10000000000', nonce: '7' };
  return action;
}

let root: Root;
let host: HTMLDivElement;
let flow: ReturnType<typeof useGiwaVault>;
function Harness() { flow = useGiwaVault(); return <output>{flow.phase}:{flow.error}</output>; }

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'ethereum', { configurable: true, value: {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [OPERATIONAL_WALLET];
      if (method === 'eth_chainId') return '0x164ce';
      throw new Error(`Unexpected wallet request: ${method}`);
    }),
    on: vi.fn(), removeListener: vi.fn(),
  } });
  external.getBlockNumber.mockResolvedValue(321);
  external.depositScope.mockResolvedValue(scope);
  external.nonces.mockResolvedValue(BigInt(7));
  const action = expectedAction();
  external.domainSeparator.mockResolvedValue(TypedDataEncoder.hashDomain(action.domain));
  external.depositActionHash.mockResolvedValue(TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message));
  external.verifyEligibility.mockResolvedValue(true);
  external.balanceOf.mockResolvedValue(BigInt('50000000000'));
  external.totalDeposits.mockResolvedValue(BigInt('11000000000'));
  external.allowance.mockResolvedValue(BigInt(0));
  external.offchain.mockResolvedValue({ valid: true });
  external.onchain.mockResolvedValue({ valid: true });
  external.create.mockResolvedValue({ requestId: 'current-request', status: 'pending', deepLink: 'zkproofport://proof-request?data=phone', pollUrl: '/api/v1/proof/current-request' });
  external.qr.mockResolvedValue('data:image/png;base64,qr');
  external.poll.mockResolvedValue(giwaResult(scope, action));
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
  expect(flow.account).toBe(OPERATIONAL_WALLET);
}

describe('Gotgan proof request orchestration', () => {
  it('sets a relay signer and sends the exact contract-bound action before accepting the proof', async () => {
    await connect();
    await act(async () => { await flow.requestProof(); });
    expect(external.signer).toHaveBeenCalledOnce();
    expect(external.signer.mock.calls[0][0]).toEqual(expect.objectContaining({ signMessage: expect.any(Function), getAddress: expect.any(Function) }));
    expect(external.signer.mock.invocationCallOrder[0]).toBeLessThan(external.create.mock.invocationCallOrder[0]);
    expect(external.create).toHaveBeenCalledWith('giwa_attestation', { scope, action: expectedAction() }, expect.objectContaining({ dappName: 'Gotgan' }));
    expect(external.nonces).toHaveBeenCalledWith(OPERATIONAL_WALLET, { blockTag: 321 });
    expect(external.depositScope).toHaveBeenCalledWith(OPERATIONAL_WALLET, BigInt('10000000000'), { blockTag: 321 });
    expect(external.verifyEligibility).toHaveBeenCalledWith(OPERATIONAL_WALLET, BigInt('10000000000'), '0x1234', expect.arrayContaining(['0x' + '00'.repeat(32)]));
    expect(flow.phase).toBe('ready');
    expect(flow.proof).toMatchObject({ account: OPERATIONAL_WALLET, amount: BigInt('10000000000'), scope });
    expect(flow.proof?.publicInputs).toHaveLength(192);
  });

  it('rejects a completed proof for a changed action before calling the vault verifier', async () => {
    await connect();
    const altered = expectedAction();
    altered.message.amount = '10000000001';
    external.poll.mockResolvedValue(giwaResult(scope, altered));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toMatch(/action/i);
    expect(flow.proof).toBeNull();
    expect(external.verifyEligibility).not.toHaveBeenCalled();
  });

  it('refuses an identity-only proof for a deposit before calling the vault verifier', async () => {
    await connect();
    external.poll.mockResolvedValue(giwaResult(scope));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.proof).toBeNull();
    expect(external.verifyEligibility).not.toHaveBeenCalled();
  });

  it('creates the fixed-wallet action proof without an injected wallet', async () => {
    delete (window as Window & { ethereum?: unknown }).ethereum;
    await act(async () => { await flow.requestProof(); });
    expect(flow.account).toBe('');
    expect(flow.phase).toBe('ready');
    expect(flow.proof).toMatchObject({ account: OPERATIONAL_WALLET, amount: BigInt('10000000000'), scope });
    expect(external.create).toHaveBeenCalledWith('giwa_attestation', { scope, action: expectedAction() }, expect.any(Object));
  });

  it('shows the proof entry and SDK QR/deep link on the initial page without a wallet', async () => {
    delete (window as Window & { ethereum?: unknown }).ethereum;
    external.poll.mockImplementation(() => new Promise(() => {}));
    await act(async () => { root.render(<GiwaDemo />); });
    const proofButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('Generate eligibility proof'));
    expect(proofButton, 'The initial page must offer SDK proof generation before wallet connection').toBeDefined();
    expect(proofButton!.disabled).toBe(false);
    await act(async () => { proofButton!.click(); });
    const qr = host.querySelector('img[alt="Scan with ZKProofport to prove eligibility for this deposit"]');
    expect(qr?.getAttribute('src')).toBe('data:image/png;base64,qr');
    expect(host.querySelector('a[href="zkproofport://proof-request?data=phone"]')?.textContent).toContain('Open ZKProofport');
    expect(external.create).toHaveBeenCalledWith('giwa_attestation', { scope, action: expectedAction() }, expect.any(Object));
  });

  it('rejects a different transaction wallet but still permits the fixed-wallet proof', async () => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async () => ['0x3333333333333333333333333333333333333333'],
    } });
    await act(async () => { await flow.connect(); });
    expect(flow.account).toBe('');
    expect(flow.error).toMatch(/configured operational wallet/i);
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('ready');
    expect(flow.proof?.account).toBe(OPERATIONAL_WALLET);
  });

  it('discards a late completed proof after the user cancels the pending request', async () => {
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    await act(async () => {
      flow.reset();
      complete(giwaResult(scope, expectedAction()));
      await requesting;
    });
    expect(flow.phase).toBe('idle');
    expect(flow.proof).toBeNull();
    expect(external.verifyEligibility).not.toHaveBeenCalled();
  });

  it('permits proof generation after the browser wallet connection is rejected', async () => {
    const provider = (window as unknown as Window & { ethereum: { request: ReturnType<typeof vi.fn> } }).ethereum;
    provider.request.mockRejectedValue(Object.assign(new Error('User rejected the request'), { code: 4001 }));
    await act(async () => { await flow.connect(); });
    expect(flow.account).toBe('');
    expect(flow.error).not.toBe('');
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('ready');
    expect(flow.proof?.account).toBe(OPERATIONAL_WALLET);
    expect(flow.error).toBe('');
    // No new wallet prompt is needed to authorize the mobile proof request.
    expect(provider.request).toHaveBeenCalledTimes(1);
  });

  it('preserves a completed fixed-wallet proof when connecting the transaction wallet afterward', async () => {
    await act(async () => { await flow.requestProof(); });
    const accepted = flow.proof;
    expect(accepted).not.toBeNull();
    await connect();
    expect(flow.proof).toBe(accepted);
    expect(flow.phase).toBe('ready');
    expect(external.create).toHaveBeenCalledOnce();
  });

  it('preserves a proof through the chainChanged event caused by connection', async () => {
    await act(async () => { await flow.requestProof(); });
    const accepted = flow.proof;
    expect(accepted).not.toBeNull();
    const provider = (window as unknown as Window & { ethereum: { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } }).ethereum;
    const changed = provider.on.mock.calls.find(([name]) => name === 'chainChanged')![1];
    let switched = false;
    provider.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [OPERATIONAL_WALLET];
      if (method === 'eth_chainId') return switched ? '0x164ce' : '0x1';
      if (method === 'wallet_switchEthereumChain') { switched = true; changed('0x164ce'); return null; }
      throw new Error(`Unexpected wallet request: ${method}`);
    });
    await connect();
    expect(flow.proof).toBe(accepted);
    expect(flow.phase).toBe('ready');
    expect(external.create).toHaveBeenCalledOnce();
  });

  it('does not cancel the independent pending QR request on wallet account changes', async () => {
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    const provider = (window as unknown as Window & { ethereum: { on: ReturnType<typeof vi.fn> } }).ethereum;
    const changed = provider.on.mock.calls.find(([name]) => name === 'accountsChanged')![1];
    await act(async () => { changed(['0x3333333333333333333333333333333333333333']); });
    expect(flow.deepLink).toBe('zkproofport://proof-request?data=phone');
    expect(flow.phase).toBe('waiting');
    await act(async () => { complete(giwaResult(scope, expectedAction())); await requesting; });
    expect(flow.phase).toBe('ready');
    expect(flow.proof?.account).toBe(OPERATIONAL_WALLET);
    expect(flow.account).toBe('');
  });

  it('keeps actual token writes unavailable without the operational signer', async () => {
    delete (window as Window & { ethereum?: unknown }).ethereum;
    await act(async () => { await flow.requestProof(); });
    expect(flow.proof).not.toBeNull();
    for (const action of ['approve', 'deposit', 'withdraw'] as const) {
      await act(async () => { await flow.act(action); });
    }
    expect(external.approve).not.toHaveBeenCalled();
    expect(external.deposit).not.toHaveBeenCalled();
    expect(external.withdraw).not.toHaveBeenCalled();
  });

  it('creates only one SDK request for repeated proof clicks while waiting', async () => {
    external.poll.mockImplementation(() => new Promise(() => {}));
    await act(async () => { void flow.requestProof(); void flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    expect(external.create).toHaveBeenCalledOnce();
  });

  it('invalidates an accepted proof when its deposit amount changes', async () => {
    await act(async () => { await flow.requestProof(); });
    expect(flow.proof).not.toBeNull();
    await act(async () => { flow.changeAmount('20000'); });
    expect(flow.amount).toBe('20000');
    expect(flow.proof).toBeNull();
    expect(flow.phase).toBe('idle');
    expect(flow.qr).toBe('');
  });

  it('ignores a cancelled request finishing after a different amount begins a new request', async () => {
    let completeOld!: (result: RelayProofResult) => void;
    external.poll.mockImplementationOnce(() => new Promise<RelayProofResult>(resolve => { completeOld = resolve; }));
    let oldRequest!: Promise<void>;
    await act(async () => { oldRequest = flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    await act(async () => { flow.reset(); flow.changeAmount('20000'); });
    const action = expectedAction(); action.message.amount = '20000000000';
    external.depositActionHash.mockResolvedValue(TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message));
    external.poll.mockResolvedValue(giwaResult(scope, action));
    await act(async () => { await flow.requestProof(); });
    expect(flow.proof?.amount).toBe(BigInt('20000000000'));
    const fresh = flow.proof;
    await act(async () => { completeOld(giwaResult(scope, expectedAction())); await oldRequest; });
    expect(flow.proof).toBe(fresh);
    expect(flow.phase).toBe('ready');
    expect(external.verifyEligibility).toHaveBeenCalledOnce();
  });

  it.each(['offchain', 'onchain'] as const)('runs the distinct %s SDK verifier without a connected wallet', async kind => {
    delete (window as Window & { ethereum?: unknown }).ethereum;
    await act(async () => { await flow.requestProof(); });
    expect(flow.proof).not.toBeNull();
    await act(async () => { await flow.verifyProof(kind); });
    expect(flow.verification).toMatchObject({ kind, status: 'success' });
    const method = kind === 'offchain' ? external.offchain : external.onchain;
    const other = kind === 'offchain' ? external.onchain : external.offchain;
    expect(method).toHaveBeenCalledOnce();
    expect(method.mock.calls[0][0]).toEqual(flow.proof!.response);
    expect(method.mock.calls[0][0]).toMatchObject({ requestId: 'current-request', proof: '0x1234', chainId: 91342, status: 'completed' });
    expect(other).not.toHaveBeenCalled();
    expect(external.approve).not.toHaveBeenCalled();
    expect(external.deposit).not.toHaveBeenCalled();
  });

  it.each(['offchain', 'onchain'] as const)('reports a %s verifier rejection instead of success', async kind => {
    await act(async () => { await flow.requestProof(); });
    const method = kind === 'offchain' ? external.offchain : external.onchain;
    method.mockResolvedValue({ valid: false, error: 'Invalid proof bytes' });
    await act(async () => { await flow.verifyProof(kind); });
    expect(flow.verification).toMatchObject({ kind, status: 'error' });
    expect(flow.verification?.message).toContain('Invalid proof bytes');
  });

  it('discards a late verification result after changing the proven amount', async () => {
    await act(async () => { await flow.requestProof(); });
    let complete!: (result: { valid: boolean }) => void;
    external.offchain.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    let verifying!: Promise<void>;
    await act(async () => { verifying = flow.verifyProof('offchain'); });
    expect(flow.verification).toMatchObject({ status: 'verifying' });
    await act(async () => { flow.changeAmount('20000'); });
    await act(async () => { complete({ valid: true }); await verifying; });
    expect(flow.proof).toBeNull();
    expect(flow.verification).toBeNull();
  });

  it('renders and executes both verification controls after receiving a proof without MetaMask', async () => {
    delete (window as Window & { ethereum?: unknown }).ethereum;
    await act(async () => { root.render(<GiwaDemo />); });
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes(label));
    await act(async () => { button('Generate eligibility proof')!.click(); });
    expect(host.textContent).toContain('Verified');
    expect(button('Off-Chain Verify')?.disabled).toBe(false);
    expect(button('On-Chain Verify')?.disabled).toBe(false);
    await act(async () => { button('Off-Chain Verify')!.click(); });
    expect(host.textContent).toContain('Off-Chain Verification Passed!');
    expect(external.offchain).toHaveBeenCalledOnce();
    expect(external.onchain).not.toHaveBeenCalled();
    await act(async () => { button('On-Chain Verify')!.click(); });
    expect(host.textContent).toContain('On-Chain Verification Passed!');
    expect(external.onchain).toHaveBeenCalledOnce();
    expect(external.onchain.mock.calls[0][0]).toEqual(external.offchain.mock.calls[0][0]);
    expect(button('Demo wallet connected')?.disabled).toBe(true);
    expect(button('Approve dKRW')).toBeUndefined();
    expect(external.approve).not.toHaveBeenCalled();
    expect(external.deposit).not.toHaveBeenCalled();
  });

  it.each(['offchain', 'onchain'] as const)('surfaces %s verifier exceptions as visible errors', async kind => {
    await act(async () => { await flow.requestProof(); });
    const method = kind === 'offchain' ? external.offchain : external.onchain;
    method.mockRejectedValue(new Error('Verification service unavailable'));
    await act(async () => { await flow.verifyProof(kind); });
    expect(flow.verification).toMatchObject({ kind, status: 'error', message: 'Verification service unavailable' });
  });

  it('does not run a verifier before a completed proof exists', async () => {
    await act(async () => { await flow.verifyProof('offchain'); await flow.verifyProof('onchain'); });
    expect(flow.verification).toBeNull();
    expect(external.offchain).not.toHaveBeenCalled();
    expect(external.onchain).not.toHaveBeenCalled();
  });

  it('times out a stuck verification and permits a subsequent retry', async () => {
    await act(async () => { await flow.requestProof(); });
    vi.useFakeTimers();
    external.onchain.mockImplementationOnce(() => new Promise(() => {}));
    let pending!: Promise<void>;
    await act(async () => { pending = flow.verifyProof('onchain'); });
    expect(flow.verification?.status).toBe('verifying');
    await act(async () => { await vi.advanceTimersByTimeAsync(30001); await pending; });
    expect(flow.verification?.status).toBe('error');
    expect(flow.verification?.message).toMatch(/timed out/i);
    await act(async () => { await flow.verifyProof('onchain'); });
    expect(flow.verification?.status).toBe('success');
  });

  it('does not accept a late proof after the consumer unmounts', async () => {
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    await act(async () => { root.render(null); });
    await act(async () => { complete(giwaResult(scope, expectedAction())); await requesting; });
    expect(external.verifyEligibility).not.toHaveBeenCalled();
  });

  it('keeps a rejected cryptographic proof unavailable for verification or deposit', async () => {
    external.verifyEligibility.mockResolvedValue(false);
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.proof).toBeNull();
    expect(flow.error).toMatch(/did not accept/i);
    await act(async () => { await flow.verifyProof('offchain'); });
    expect(external.offchain).not.toHaveBeenCalled();
  });

  it.each(['accountsChanged', 'chainChanged'])('stops an in-flight write after %s while keeping the fixed-wallet proof', async event => {
    await act(async () => { await flow.requestProof(); });
    await connect();
    const accepted = flow.proof;
    expect(accepted).not.toBeNull();
    let continueBalance!: (balance: bigint) => void;
    let reachedBalance = false;
    external.balanceOf.mockImplementationOnce(() => {
      reachedBalance = true;
      return new Promise<bigint>(resolve => { continueBalance = resolve; });
    });
    let writing!: Promise<void>;
    await act(async () => {
      writing = flow.act('approve');
      await vi.waitFor(() => { expect(reachedBalance).toBe(true); });
    });
    const provider = (window as unknown as Window & { ethereum: { on: ReturnType<typeof vi.fn> } }).ethereum;
    const changed = provider.on.mock.calls.find(([name]) => name === event)![1];
    await act(async () => { changed(event === 'chainChanged' ? '0x1' : []); });
    await act(async () => { continueBalance(BigInt('50000000000')); await writing; });
    expect(flow.account).toBe('');
    expect(flow.proof).toBe(accepted);
    expect(flow.error).toMatch(/wallet or network changed/i);
    expect(external.approve).not.toHaveBeenCalled();
    expect(external.deposit).not.toHaveBeenCalled();
    expect(flow.txHash).toBe('');
  });

  it('shows the mobile app deep-link button instead of a QR code on an iPhone', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    delete (window as Window & { ethereum?: unknown }).ethereum;
    external.poll.mockImplementation(() => new Promise(() => {}));
    await act(async () => { root.render(<GiwaDemo />); });
    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('Generate eligibility proof'));
    expect(button?.disabled).toBe(false);
    await act(async () => { button!.click(); });
    const appLink = host.querySelector('a[href="zkproofport://proof-request?data=phone"]');
    expect(appLink?.textContent).toContain('Open ZKProofport');
    expect(host.querySelector('img[alt="Scan with ZKProofport to prove eligibility for this deposit"]')).toBeNull();
  });

  it('does not clear a newer proof when an abandoned transaction scope check resolves late', async () => {
    await act(async () => { await flow.requestProof(); });
    await connect();
    let finishOldScope!: (value: string) => void;
    let requestedOldScope = false;
    external.depositScope.mockImplementationOnce(() => {
      requestedOldScope = true;
      return new Promise<string>(resolve => { finishOldScope = resolve; });
    });
    let oldWrite!: Promise<void>;
    await act(async () => {
      oldWrite = flow.act('approve');
      await vi.waitFor(() => { expect(requestedOldScope).toBe(true); });
    });
    const provider = (window as unknown as Window & { ethereum: { on: ReturnType<typeof vi.fn> } }).ethereum;
    const changed = provider.on.mock.calls.find(([name]) => name === 'accountsChanged')![1];
    await act(async () => { changed([]); });
    await act(async () => { flow.reset(); });
    const freshScope = 'giwa-vault:v1:' + 'cd'.repeat(32);
    const action = expectedAction(); action.message.nonce = '8';
    external.nonces.mockResolvedValue(BigInt(8));
    external.depositScope.mockResolvedValue(freshScope);
    external.depositActionHash.mockResolvedValue(TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message));
    external.poll.mockResolvedValue(giwaResult(freshScope, action));
    await act(async () => { await flow.requestProof(); });
    expect(flow.proof?.scope).toBe(freshScope);
    const fresh = flow.proof;
    await act(async () => { finishOldScope('obsolete-scope'); await oldWrite; });
    expect(flow.proof).toBe(fresh);
    expect(flow.phase).toBe('ready');
    expect(flow.error).toBe('');
    expect(external.approve).not.toHaveBeenCalled();
  });

  it('stops before relay creation when the deployed vault action differs', async () => {
    await connect();
    external.depositActionHash.mockResolvedValue('0x' + '00'.repeat(32));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toMatch(/different deposit action/i);
    expect(external.create).not.toHaveBeenCalled();
  });

  it('surfaces a failed RPC lookup without creating a relay request', async () => {
    await connect();
    external.getBlockNumber.mockRejectedValue(new Error('RPC unavailable'));
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.error).toContain('RPC unavailable');
    expect(external.create).not.toHaveBeenCalled();
  });
});
