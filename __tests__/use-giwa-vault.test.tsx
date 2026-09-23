// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, TypedDataEncoder } from 'ethers';
import type { RelayProofResult } from '@zkproofport-app/sdk';
import { useGiwaVault } from '../lib/useGiwaVault';
import GiwaDemo from '../app/components/GiwaDemo';
import { TOKEN_ADDRESS, VAULT_ADDRESS } from '../lib/giwa-vault';
import { depositAction, giwaResult, GIWA_TEST_ACCOUNT } from './fixtures/giwa';

const external = vi.hoisted(() => ({
  signer: vi.fn(), create: vi.fn(), poll: vi.fn(), qr: vi.fn(), disconnect: vi.fn(),
  getBlockNumber: vi.fn(), depositScope: vi.fn(), nonces: vi.fn(), domainSeparator: vi.fn(),
  depositActionHash: vi.fn(), verifyEligibility: vi.fn(), balanceOf: vi.fn(),
  totalDeposits: vi.fn(), allowance: vi.fn(), destroy: vi.fn(),
  offchain: vi.fn(), onchain: vi.fn(), approve: vi.fn(), deposit: vi.fn(), depositPreflight: vi.fn(), withdraw: vi.fn(),
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
      deposit = Object.assign(external.deposit, { staticCall: external.depositPreflight });
      withdraw = external.withdraw;
    },
  };
});

const scope = 'giwa-vault:v1:' + 'ab'.repeat(32);
function expectedAction(account = GIWA_TEST_ACCOUNT) {
  const action = depositAction();
  action.domain.verifyingContract = VAULT_ADDRESS;
  action.message = { account, asset: TOKEN_ADDRESS, amount: '10000000000', nonce: '7' };
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
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [GIWA_TEST_ACCOUNT];
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
  expect(flow.account).toBe(GIWA_TEST_ACCOUNT);
}

describe('Gotgan proof request orchestration', () => {
  it('reads only the vault total and requires a wallet before requesting a proof', async () => {
    expect(flow.balances).toMatchObject({ wallet: null, deposited: null, allowance: null, total: BigInt('11000000000') });
    expect(external.balanceOf).not.toHaveBeenCalled();
    await act(async () => { await flow.requestProof(); });
    expect(flow.error).toMatch(/connect your wallet/i);
    expect(external.create).not.toHaveBeenCalled();
    for (const action of ['approve', 'deposit', 'withdraw'] as const) {
      await act(async () => { await flow.act(action); });
    }
    expect(external.approve).not.toHaveBeenCalled();
    expect(external.deposit).not.toHaveBeenCalled();
    expect(external.withdraw).not.toHaveBeenCalled();
  });

  it.each([GIWA_TEST_ACCOUNT, '0x3333333333333333333333333333333333333333'])('binds the proof and balance reads to the chosen account %s', async account => {
    const provider = (window as unknown as { ethereum: { request: ReturnType<typeof vi.fn> } }).ethereum;
    provider.request.mockImplementation(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x164ce' : [account]);
    const action = expectedAction(account);
    external.depositActionHash.mockResolvedValue(TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message));
    external.poll.mockResolvedValue(giwaResult(scope, action));
    await act(async () => { await flow.connect(); });
    expect(flow.account).toBe(account);
    expect(external.balanceOf).toHaveBeenCalledWith(account);
    expect(external.allowance).toHaveBeenCalledWith(account, VAULT_ADDRESS);
    await act(async () => { await flow.requestProof(); });
    expect(external.create).toHaveBeenCalledWith('giwa_attestation', { scope, action }, expect.any(Object));
    expect(flow.proof?.account).toBe(account);
  });

  it.each(['accountsChanged', 'chainChanged'])('discards a pending proof after %s, including a late relay result', async event => {
    await connect();
    let complete!: (result: RelayProofResult) => void;
    external.poll.mockImplementation(() => new Promise<RelayProofResult>(resolve => { complete = resolve; }));
    let requesting!: Promise<void>;
    await act(async () => { requesting = flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    const provider = (window as unknown as { ethereum: { on: ReturnType<typeof vi.fn> } }).ethereum;
    const changed = provider.on.mock.calls.find(([name]) => name === event)![1];
    await act(async () => { changed(event === 'chainChanged' ? '0x1' : []); });
    expect(flow.account).toBe('');
    expect(flow.qr).toBe('');
    expect(flow.deepLink).toBe('');
    await act(async () => { complete(giwaResult(scope, expectedAction())); await requesting; });
    expect(flow.phase).toBe('idle');
    expect(flow.proof).toBeNull();
    expect(external.verifyEligibility).not.toHaveBeenCalled();
  });

  it('refuses token writes if the injected signer silently changes after proof generation', async () => {
    await connect();
    await act(async () => { await flow.requestProof(); });
    const provider = (window as unknown as { ethereum: { request: ReturnType<typeof vi.fn> } }).ethereum;
    provider.request.mockResolvedValue(['0x3333333333333333333333333333333333333333']);
    await act(async () => { await flow.act('approve'); });
    expect(flow.error).toMatch(/reconnect/i);
    expect(external.approve).not.toHaveBeenCalled();
  });

  it('connects after switching to GIWA, then creates a proof for the selected account', async () => {
    const provider = (window as unknown as { ethereum: { request: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } }).ethereum;
    const changed = provider.on.mock.calls.find(([name]) => name === 'chainChanged')![1];
    let switched = false;
    provider.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [GIWA_TEST_ACCOUNT];
      if (method === 'eth_chainId') return switched ? '0x164ce' : '0x1';
      if (method === 'wallet_switchEthereumChain') { switched = true; changed('0x164ce'); return null; }
      throw new Error(`Unexpected wallet request: ${method}`);
    });
    await connect();
    expect(flow.error).toBe('');
    await act(async () => { await flow.requestProof(); });
    expect(flow.proof?.account).toBe(GIWA_TEST_ACCOUNT);
  });

  it.each([false, true])('shows the desktop QR or mobile app link after connecting (mobile=%s)', async mobile => {
    if (mobile) vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    external.poll.mockImplementation(() => new Promise(() => {}));
    await act(async () => { root.render(<GiwaDemo />); });
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label);
    expect(button('Generate eligibility proof')).toBeUndefined();
    expect(host.textContent).toContain('Not connected');
    await act(async () => { button('Connect operational wallet')!.click(); });
    await act(async () => { button('Generate eligibility proof')!.click(); });
    const qr = host.querySelector('img[alt="Scan with ZKProofport to prove eligibility for this deposit"]');
    if (mobile) expect(qr).toBeNull();
    else {
      expect(qr?.getAttribute('src')).toBe('data:image/png;base64,qr');
      expect(qr?.getAttribute('width')).toBe('360');
      expect(external.qr).toHaveBeenCalledWith('zkproofport://proof-request?data=phone', { width: 1080 });
    }
    expect(host.querySelector('a[href="zkproofport://proof-request?data=phone"]')).not.toBeNull();
  });

  it('reaches rejection, automatic proof verification, approval, deposit and withdrawal through the UI', async () => {
    const units = BigInt('10000000000');
    const depositHash = '0x' + '12'.repeat(32);
    const withdrawHash = '0x' + '34'.repeat(32);
    const approveHash = '0x' + '56'.repeat(32);
    external.depositPreflight.mockRejectedValue({ data: new Interface(['error ProofRequired()']).encodeErrorResult('ProofRequired') });
    external.approve.mockImplementation(async () => {
      external.allowance.mockResolvedValue(units);
      return { hash: approveHash, wait: async () => ({ hash: approveHash, status: 1 }) };
    });
    let confirmDeposit!: (receipt: { hash: string; status: number }) => void;
    external.deposit.mockResolvedValue({ hash: depositHash, wait: () => new Promise(resolve => { confirmDeposit = resolve; }) });
    external.withdraw.mockResolvedValue({ hash: withdrawHash, wait: async () => ({ hash: withdrawHash, status: 1 }) });
    await act(async () => { root.render(<GiwaDemo />); });
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === label);
    const click = async (label: string) => {
      expect(button(label), `Missing UI action: ${label}`).toBeDefined();
      expect(button(label)!.disabled).toBe(false);
      await act(async () => { button(label)!.click(); });
    };
    await click('Connect operational wallet');
    expect(host.querySelector('[aria-label="Connected operational wallet"]')?.getAttribute('title')).toBe(GIWA_TEST_ACCOUNT);
    await click('Deposit dKRW');
    expect(external.depositPreflight).toHaveBeenCalledWith(units, '0x', [], { from: GIWA_TEST_ACCOUNT });
    expect(host.textContent).toContain('Deposit blocked');
    expect(external.deposit).not.toHaveBeenCalled();
    await click('Generate eligibility proof');
    expect(host.textContent).toContain('Verified');
    expect(external.verifyEligibility).toHaveBeenCalledOnce();
    expect(button('Off-Chain Verify')).toBeUndefined();
    expect(button('On-Chain Verify')).toBeUndefined();
    expect(external.offchain).not.toHaveBeenCalled();
    expect(external.onchain).not.toHaveBeenCalled();
    await click('Approve dKRW');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(button('Deposit dKRW')?.disabled).toBe(false);
    });
    expect(external.approve).toHaveBeenCalledWith(VAULT_ADDRESS, units, { chainId: 91342 });
    expect(external.deposit).not.toHaveBeenCalled();
    await click('Deposit dKRW');
    await act(async () => { await vi.waitFor(() => expect(confirmDeposit).toBeTypeOf('function')); });
    expect(external.deposit).toHaveBeenCalledWith(units, '0x1234', expect.any(Array), { chainId: 91342 });
    expect(host.textContent).not.toContain('Deposit confirmed');
    await act(async () => { confirmDeposit({ hash: depositHash, status: 1 }); });
    expect(host.textContent).toContain('Deposit confirmed');
    expect(host.querySelector(`a[href$="/tx/${depositHash}"]`)).not.toBeNull();
    await click('Withdraw');
    await click('Withdraw dKRW');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.textContent).toContain('Withdrawal confirmed');
    });
    expect(external.withdraw).toHaveBeenCalledWith(units, { chainId: 91342 });
    expect(external.create).toHaveBeenCalledOnce();
  });

  it('sets a relay signer and sends the exact contract-bound action before accepting the proof', async () => {
    await connect();
    await act(async () => { await flow.requestProof(); });
    expect(external.signer).toHaveBeenCalledOnce();
    expect(external.signer.mock.calls[0][0]).toEqual(expect.objectContaining({ signMessage: expect.any(Function), getAddress: expect.any(Function) }));
    expect(external.signer.mock.invocationCallOrder[0]).toBeLessThan(external.create.mock.invocationCallOrder[0]);
    expect(external.create).toHaveBeenCalledWith('giwa_attestation', { scope, action: expectedAction() }, expect.objectContaining({ dappName: 'Gotgan' }));
    expect(external.nonces).toHaveBeenCalledWith(GIWA_TEST_ACCOUNT, { blockTag: 321 });
    expect(external.depositScope).toHaveBeenCalledWith(GIWA_TEST_ACCOUNT, BigInt('10000000000'), { blockTag: 321 });
    expect(external.verifyEligibility).toHaveBeenCalledWith(GIWA_TEST_ACCOUNT, BigInt('10000000000'), '0x1234', expect.arrayContaining(['0x' + '00'.repeat(32)]));
    expect(flow.phase).toBe('ready');
    expect(flow.proof).toMatchObject({ account: GIWA_TEST_ACCOUNT, amount: BigInt('10000000000'), scope });
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

  it('discards a late completed proof after the user cancels the pending request', async () => {
    await connect();
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

  it('creates only one SDK request for repeated proof clicks while waiting', async () => {
    await connect();
    external.poll.mockImplementation(() => new Promise(() => {}));
    await act(async () => { void flow.requestProof(); void flow.requestProof(); });
    expect(flow.phase).toBe('waiting');
    expect(external.create).toHaveBeenCalledOnce();
  });

  it('invalidates an accepted proof when its deposit amount changes', async () => {
    await connect();
    await act(async () => { await flow.requestProof(); });
    expect(flow.proof).not.toBeNull();
    await act(async () => { flow.changeAmount('20000'); });
    expect(flow.amount).toBe('20000');
    expect(flow.proof).toBeNull();
    expect(flow.phase).toBe('idle');
    expect(flow.qr).toBe('');
  });

  it('ignores a cancelled request finishing after a different amount begins a new request', async () => {
    await connect();
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

  it('does not accept a late proof after the consumer unmounts', async () => {
    await connect();
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
    await connect();
    external.verifyEligibility.mockResolvedValue(false);
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('blocked');
    expect(flow.proof).toBeNull();
    expect(flow.error).toMatch(/did not accept/i);
    expect(external.approve).not.toHaveBeenCalled();
    expect(external.deposit).not.toHaveBeenCalled();
  });

  it.each(['accountsChanged', 'chainChanged'])('stops an in-flight write after %s and invalidates its proof', async event => {
    await connect();
    await act(async () => { await flow.requestProof(); });
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
    expect(flow.proof).toBeNull();
    expect(flow.error).toMatch(/wallet or network changed/i);
    expect(external.approve).not.toHaveBeenCalled();
    expect(external.deposit).not.toHaveBeenCalled();
    expect(flow.txHash).toBe('');
  });

  it('does not clear a newer proof when an abandoned transaction scope check resolves late', async () => {
    await connect();
    await act(async () => { await flow.requestProof(); });
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
    await connect();
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
