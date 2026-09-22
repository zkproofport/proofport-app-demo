import { Interface, formatUnits, isAddress, isError, MaxUint256, parseUnits, ZeroAddress, type Eip1193Provider, type TransactionReceipt } from 'ethers';
import { type TypedAction } from '@zkproofport-app/sdk';
import { GIWA_CHAIN_ID } from './giwa-membership';

export const VAULT_ADDRESS = '0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c';
export const TOKEN_ADDRESS = '0x417573024528f3c9daD782eF5316E992F3029e81';
export const OPERATIONAL_WALLET = '0x3fee628efe472ff6a6dce527523b131f2d973afb';
export const GIWA_RPC = 'https://sepolia-rpc.giwa.io';
export const EXPLORER = 'https://sepolia-explorer.giwa.io';
export const TOKEN_DECIMALS = 6;
export const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
export const VAULT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalDeposits() view returns (uint256)',
  'function depositScope(address,uint256) view returns (string)',
  'function nonces(address) view returns (uint256)',
  'function domainSeparator() view returns (bytes32)',
  'function depositActionHash(address,uint256) view returns (bytes32)',
  'function verifyEligibility(address,uint256,bytes,bytes32[]) view returns (bool)',
  'function deposit(uint256,bytes,bytes32[])',
  'function withdraw(uint256)',
  'error ProofRequired()', 'error WrongDepositScope()', 'error InvalidProof()',
  'error UntrustedIssuer()', 'error InsufficientBalance()', 'error TokenTransferFailed()',
  'error IdentityProofNotAllowed()', 'error WrongDepositDomain()', 'error WrongDepositAction()',
];
const vaultInterface = new Interface(VAULT_ABI);

/** Recheck wallet authority at the send boundary, after ethers' async gas estimation. */
export function guardGiwaWalletProvider(provider: Eip1193Provider, isCurrent: () => boolean): Eip1193Provider {
  return { request: async (request) => {
    if (!isCurrent()) throw new Error('Wallet or network changed. Reconnect the operational wallet.');
    if (request.method === 'eth_sendTransaction') {
      const transaction = Array.isArray(request.params) ? request.params[0] : undefined;
      if (!transaction || Number(transaction.chainId) !== GIWA_CHAIN_ID) {
        throw new Error('The transaction must explicitly target GIWA Sepolia.');
      }
    }
    return provider.request(request);
  } };
}

/** Build exactly the action checked by the deployed Gotgan v2 vault. */
export function buildGiwaDepositAction(account: string, amount: bigint, nonce: bigint, vaultAddress = VAULT_ADDRESS): TypedAction {
  if (!isAddress(account) || account.toLowerCase() === ZeroAddress) throw new Error('Invalid deposit account address.');
  if (!isAddress(vaultAddress) || vaultAddress.toLowerCase() === ZeroAddress) throw new Error('Invalid vault address.');
  if (amount <= BigInt(0) || amount > MaxUint256) throw new Error('Invalid deposit amount.');
  if (nonce < BigInt(0) || nonce > MaxUint256) throw new Error('Invalid deposit nonce.');
  return {
    domain: { name: 'Gotgan', version: '2', chainId: GIWA_CHAIN_ID, verifyingContract: vaultAddress },
    primaryType: 'Deposit',
    types: { Deposit: [
      { name: 'account', type: 'address' }, { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    ] },
    message: { account, asset: TOKEN_ADDRESS, amount: amount.toString(), nonce: nonce.toString() },
  };
}

type VaultReceipt = Pick<TransactionReceipt, 'hash' | 'status'>;

/** A wallet fee bump replaces the hash without changing the requested vault action. */
export async function waitForVaultReceipt(
  tx: { wait: () => Promise<VaultReceipt | null> },
  onReplacement: (hash: string) => void,
): Promise<VaultReceipt> {
  let receipt: VaultReceipt | null;
  try {
    receipt = await tx.wait();
  } catch (cause) {
    if (!isError(cause, 'TRANSACTION_REPLACED')) throw cause;
    onReplacement(cause.receipt.hash);
    if (cause.cancelled || cause.reason !== 'repriced') {
      throw new Error(cause.reason === 'cancelled'
        ? 'The transaction was cancelled in your wallet.'
        : 'The transaction was replaced with a different action. Check the transaction before retrying.');
    }
    receipt = cause.receipt;
  }
  if (!receipt || receipt.status !== 1) throw new Error('The transaction was not confirmed successfully. Check the explorer.');
  return receipt;
}

export function parseVaultAmount(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error('Enter an amount with up to 6 decimal places.');
  const amount = parseUnits(value, TOKEN_DECIMALS);
  if (amount <= BigInt(0)) throw new Error('Enter an amount greater than zero.');
  if (amount >= BigInt(2) ** BigInt(256)) throw new Error('This amount is too large.');
  return amount;
}

export function displayKRW(value: bigint | null): string {
  if (value === null) return '—';
  const [whole, fraction] = formatUnits(value, TOKEN_DECIMALS).split('.');
  return BigInt(whole).toLocaleString('en-US') + (fraction && fraction !== '0' ? `.${fraction}` : '');
}

export function vaultErrorName(cause: unknown): string | undefined {
  const error = cause as { data?: string; info?: { error?: { data?: string | { data?: string } } } };
  const nested = error?.info?.error?.data;
  const data = error?.data || (typeof nested === 'string' ? nested : nested?.data);
  try { return typeof data === 'string' ? vaultInterface.parseError(data)?.name : undefined; } catch { return undefined; }
}

export function vaultErrorMessage(cause: unknown): string {
  const error = cause as { code?: string | number; shortMessage?: string; message?: string };
  if (error?.code === 'ACTION_REJECTED' || error?.code === 4001) return 'The wallet request was declined. You can try again.';
  const name = vaultErrorName(cause);
  if (['WrongDepositScope', 'WrongDepositDomain', 'WrongDepositAction', 'IdentityProofNotAllowed'].includes(name ?? '')) return 'This proof no longer matches the deposit. Generate a new proof.';
  if (name === 'InvalidProof' || name === 'UntrustedIssuer') return 'The eligibility proof did not pass the Vault check. Generate a new proof.';
  if (name === 'TokenTransferFailed') return 'Token transfer failed. Check your dKRW balance and Vault allowance.';
  return error?.shortMessage || error?.message || 'The request could not finish. Please try again.';
}
