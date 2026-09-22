// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypedDataEncoder } from 'ethers';
import type { RelayProofResult } from '@zkproofport-app/sdk';
import { useGiwaVault } from '../lib/useGiwaVault';
import { OPERATIONAL_WALLET, TOKEN_ADDRESS, VAULT_ADDRESS } from '../lib/giwa-vault';
import { depositAction, giwaResult } from './fixtures/giwa';

const external = vi.hoisted(() => ({
  signer: vi.fn(), create: vi.fn(), poll: vi.fn(), qr: vi.fn(), disconnect: vi.fn(),
  getBlockNumber: vi.fn(), depositScope: vi.fn(), nonces: vi.fn(), domainSeparator: vi.fn(),
  depositActionHash: vi.fn(), verifyEligibility: vi.fn(), balanceOf: vi.fn(),
  totalDeposits: vi.fn(), allowance: vi.fn(), destroy: vi.fn(),
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

  it('does not create a proof request until the operational wallet is connected', async () => {
    await act(async () => { await flow.requestProof(); });
    expect(flow.phase).toBe('idle');
    expect(external.create).not.toHaveBeenCalled();
  });

  it('does not admit a different wallet into the deposit proof flow', async () => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: {
      request: async () => ['0x3333333333333333333333333333333333333333'],
    } });
    await act(async () => { await flow.connect(); });
    await act(async () => { await flow.requestProof(); });
    expect(flow.account).toBe('');
    expect(flow.error).toMatch(/configured operational wallet/i);
    expect(external.create).not.toHaveBeenCalled();
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
