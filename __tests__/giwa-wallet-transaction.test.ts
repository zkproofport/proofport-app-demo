import { BrowserProvider, Contract, type Eip1193Provider } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { guardGiwaWalletProvider } from '../lib/giwa-vault';

const account = '0x3fee628efe472ff6a6dce527523b131f2d973afb';
const tokenAddress = '0x417573024528f3c9daD782eF5316E992F3029e81';
const vaultAddress = '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c';

describe('GIWA transaction provider guard', () => {
  it('blocks the final send when the wallet changes during real ethers gas estimation', async () => {
    let current = true;
    let releaseEstimate!: (gas: string) => void;
    let estimating!: () => void;
    const estimateStarted = new Promise<void>(resolve => { estimating = resolve; });
    const sent: unknown[] = [];
    const wallet: Eip1193Provider = {
      request: async ({ method, params }) => {
        if (method === 'eth_chainId') return '0x164ce';
        if (method === 'eth_accounts') return [account];
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_estimateGas') {
          estimating();
          return new Promise<string>(resolve => { releaseEstimate = resolve; });
        }
        if (method === 'eth_sendTransaction') {
          sent.push(params);
          throw new Error('Test boundary: no transaction is broadcast');
        }
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
    const provider = new BrowserProvider(guardGiwaWalletProvider(wallet, () => current));
    try {
      const signer = await provider.getSigner(account);
      const token = new Contract(tokenAddress, ['function approve(address,uint256) returns (bool)'], signer);
      // Keep ethers' asynchronous preparation real; mocking Contract.approve
      // would skip the gap between the hook's preflight and the final send.
      const writing = token.approve(vaultAddress, BigInt(10), { chainId: 91342 }).catch(error => error);
      await estimateStarted;
      current = false;
      releaseEstimate('0x10000');
      expect(await writing).toBeInstanceOf(Error);
      expect(sent).toEqual([]);
    } finally {
      provider.destroy();
    }
  });

  it('forwards a current transaction explicitly bound to GIWA', async () => {
    const request = vi.fn().mockResolvedValue('0x' + 'ab'.repeat(32));
    const guarded = guardGiwaWalletProvider({ request }, () => true);
    const transaction = { from: account, to: tokenAddress, chainId: '0x164ce', data: '0x095ea7b3' };
    const result = await guarded.request({ method: 'eth_sendTransaction', params: [transaction] });
    expect(result).toBe('0x' + 'ab'.repeat(32));
    expect(request).toHaveBeenCalledWith({ method: 'eth_sendTransaction', params: [transaction] });
  });

  it.each([undefined, '0x1', 1, 'not-a-chain'])('never forwards a transaction with chainId %s', async chainId => {
    const request = vi.fn();
    const guarded = guardGiwaWalletProvider({ request }, () => true);
    const transaction = { from: account, to: tokenAddress, chainId };
    await expect(guarded.request({ method: 'eth_sendTransaction', params: [transaction] })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects wallet RPC after its transaction authority becomes stale', async () => {
    const request = vi.fn();
    const guarded = guardGiwaWalletProvider({ request }, () => false);
    await expect(guarded.request({ method: 'eth_accounts' })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
