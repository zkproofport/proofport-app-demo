import { describe, expect, it, vi } from 'vitest';
import { Interface, MaxUint256 } from 'ethers';
import { buildGiwaDepositAction, displayKRW, parseVaultAmount, vaultErrorMessage, vaultErrorName, waitForVaultReceipt, VAULT_ABI } from '../lib/giwa-vault';
import { prepareGiwaMembershipProof } from '../lib/giwa-membership';
import { depositAction, giwaResult, GIWA_TEST_ACCOUNT, GIWA_TEST_VAULT } from './fixtures/giwa';

describe('dKRW amounts are exact six-decimal integers', () => {
  it('converts the institutional deposit amount without floating point', () => {
    expect(parseVaultAmount('10000')).toBe(BigInt('10000000000'));
    expect(parseVaultAmount('0.000001')).toBe(BigInt(1));
    expect(parseVaultAmount('9007199254740993.123456')).toBe(BigInt('9007199254740993123456'));
  });
  it.each(['0', '-1', '1.0000001', '1e4', '10,000', '', 'NaN', 'Infinity', ' 1', '1.', '0x10', '9'.repeat(90)])('rejects invalid amounts: %s', value => {
    expect(() => parseVaultAmount(value)).toThrow();
  });
  it('preserves precision and distinguishes unknown balances from zero', () => {
    expect(displayKRW(null)).toBe('—');
    expect(displayKRW(BigInt(0))).toBe('0');
    expect(displayKRW(BigInt('9007199254740993123456'))).toBe('9,007,199,254,740,993.123456');
    expect(displayKRW(BigInt(1))).toBe('0.000001');
  });
});

describe('contract rejection is distinguished from a network failure', () => {
  const abi = new Interface(VAULT_ABI);
  const rejected = abi.encodeErrorResult('ProofRequired');
  it('recognizes a genuine missing-proof revert', () => {
    expect(vaultErrorName({ data: rejected })).toBe('ProofRequired');
    expect(vaultErrorName({ info: { error: { data: rejected } } })).toBe('ProofRequired');
    expect(vaultErrorName({ info: { error: { data: { data: rejected } } } })).toBe('ProofRequired');
  });
  it('does not present RPC errors or other reverts as successful policy enforcement', () => {
    expect(vaultErrorName(new Error('RPC unavailable'))).toBeUndefined();
    expect(vaultErrorName({ data: '0x1234' })).toBeUndefined();
    expect(vaultErrorName({ data: abi.encodeErrorResult('InvalidProof') })).toBe('InvalidProof');
  });
  it('gives a recoverable error after a wallet rejection or stale nonce', () => {
    expect(vaultErrorMessage({ code: 4001 })).toContain('declined');
    expect(vaultErrorMessage({ data: abi.encodeErrorResult('WrongDepositScope') })).toContain('new proof');
  });
});

describe('Vault mobile proof binding', () => {
  const scope = 'giwa-vault:v1:' + 'ab'.repeat(32);
  const action = depositAction();
  const result = giwaResult(scope, action);
  it('accepts the exact scope returned by depositScope for policy preflight', () => {
    expect(prepareGiwaMembershipProof(result, result.requestId, scope, action).publicInputs).toHaveLength(192);
  });
  it('rejects proof reuse for a changed amount, wallet or consumed nonce scope', () => {
    expect(() => prepareGiwaMembershipProof(result, result.requestId, 'giwa-vault:v1:' + 'cd'.repeat(32), action)).toThrow();
  });
});

describe('Gotgan deposit action construction', () => {
  it('binds the account, asset, amount and nonce to the v2 vault EIP-712 domain', () => {
    expect(buildGiwaDepositAction(GIWA_TEST_ACCOUNT, BigInt(1000000), BigInt(0), GIWA_TEST_VAULT)).toEqual(depositAction());
  });

  it.each([BigInt(1), MaxUint256])('keeps boundary amounts exact and JSON serializable: %s', amount => {
    const action = buildGiwaDepositAction(GIWA_TEST_ACCOUNT, amount, MaxUint256, GIWA_TEST_VAULT);
    expect(action.message.amount).toBe(amount.toString());
    expect(action.message.nonce).toBe(MaxUint256.toString());
    expect(() => JSON.stringify(action)).not.toThrow();
  });

  it.each([BigInt(-1), BigInt(0), MaxUint256 + BigInt(1), MaxUint256 * BigInt(2)])('rejects an amount outside uint256 deposit bounds: %s', amount => {
    expect(() => buildGiwaDepositAction(GIWA_TEST_ACCOUNT, amount, BigInt(0), GIWA_TEST_VAULT)).toThrow(/amount/i);
  });

  it.each([BigInt(-1), MaxUint256 + BigInt(1), MaxUint256 * BigInt(2)])('rejects an invalid nonce: %s', nonce => {
    expect(() => buildGiwaDepositAction(GIWA_TEST_ACCOUNT, BigInt(1), nonce, GIWA_TEST_VAULT)).toThrow(/nonce/i);
  });

  it.each(['', ' ', '0x', '0x1234', '0x' + '00'.repeat(20), '0x' + 'gg'.repeat(20), '0x' + '11'.repeat(21), '%_\\', '<script>', '한글👛'])('rejects an unusable account or vault address: %s', address => {
    expect(() => buildGiwaDepositAction(address, BigInt(1), BigInt(0), GIWA_TEST_VAULT)).toThrow(/address|account/i);
    expect(() => buildGiwaDepositAction(GIWA_TEST_ACCOUNT, BigInt(1), BigInt(0), address)).toThrow(/address|vault/i);
  });
});

describe('wallet transaction replacement', () => {
  const receipt = { hash: '0xreplacement', status: 1 };
  const replaced = (reason: string, status = 1) => ({ wait: async () => {
    throw { code: 'TRANSACTION_REPLACED', reason, cancelled: reason !== 'repriced', receipt: { ...receipt, status } };
  } });
  it('accepts an ordinary successful receipt', async () => {
    const update = vi.fn();
    await expect(waitForVaultReceipt({ wait: async () => receipt }, update)).resolves.toEqual(receipt);
    expect(update).not.toHaveBeenCalled();
  });
  it('accepts a fee bump and updates the explorer link to the mined hash', async () => {
    const update = vi.fn();
    await expect(waitForVaultReceipt(replaced('repriced'), update)).resolves.toEqual(receipt);
    expect(update).toHaveBeenCalledWith(receipt.hash);
  });
  it.each(['cancelled', 'replaced'])('does not report a %s action as a successful vault transaction', async reason => {
    const update = vi.fn();
    await expect(waitForVaultReceipt(replaced(reason), update)).rejects.toThrow(reason === 'cancelled' ? 'cancelled' : 'different action');
    expect(update).toHaveBeenCalledWith(receipt.hash);
  });
  it('rejects a reverted fee-bump receipt', async () => {
    await expect(waitForVaultReceipt(replaced('repriced', 0), vi.fn())).rejects.toThrow('not confirmed successfully');
  });
  it('rejects missing or reverted ordinary receipts', async () => {
    for (const result of [null, { ...receipt, status: 0 }]) {
      await expect(waitForVaultReceipt({ wait: async () => result }, vi.fn())).rejects.toThrow('not confirmed successfully');
    }
  });
  it('preserves other wallet and network errors', async () => {
    const failure = new Error('RPC unavailable');
    await expect(waitForVaultReceipt({ wait: async () => { throw failure; } }, vi.fn())).rejects.toBe(failure);
  });
});
