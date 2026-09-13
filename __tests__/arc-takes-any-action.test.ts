import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildDemoInputs, DEFAULT_OPTIONS, DEMO_VERIFIERS, ARC_ACTIONS } from '../lib/demo-policy';
import { CIRCUIT_IDS } from '@zkproofport-app/sdk';
import { DEMOS } from '../lib/demo-catalog';

/**
 * The Arc demo offers three named actions and a way to write your own.
 *
 * `arc_eligibility` proves a wallet authorised one action, and the circuit
 * hashes that action without reading it — so any structure is provable. The
 * three cards mirror the mobile app; the fourth choice is what keeps the demo
 * honest about the circuit, and it is a field editor rather than a JSON box,
 * because a demo that asks you to hand-write EIP-712 types is not a demo.
 *
 * What it must NOT accept is an action that cannot be honestly proved: a value
 * that does not match its declared type is signed and hashed exactly like a
 * correct one, and only fails much later at a contract that decodes it.
 */
const arc = DEMOS.find(demo => demo.id === 'arc')!;
const scope = 'ledger house:arc:test';
const build = (patch: Partial<typeof DEFAULT_OPTIONS>) =>
  buildDemoInputs(arc, { ...DEFAULT_OPTIONS, ...patch }, scope) as {
    action: { domain: Record<string, unknown>; types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; message: Record<string, unknown> };
  };

describe('the Arc demo takes any action', () => {
  it('refuses a newly added named field without an input instead of reusing nonce', () => {
    const field = ARC_ACTIONS[0].fields[0] as {name: string; type: string};
    const original = field.name;
    try {
      field.name = 'newField';
      expect(() => build({})).toThrow(/No input is configured for action field 'newField'/);
    } finally {
      field.name = original;
    }
  });

  it('carries the default 예치 through unchanged', () => {
    const { action } = build({});
    expect(action.primaryType).toBe('Deposit');
    expect(action.message).toEqual({ amount: '1000000', nonce: '1' });
    expect(action.domain.chainId).toBe(5042002);
  });

  it('offers the same three actions the mobile app does', () => {
    expect(ARC_ACTIONS.map(action => action.name)).toEqual(['Deposit', 'Withdraw', 'Transfer']);
  });

  it('builds 전송 from the recipient box, not from typed-out JSON', () => {
    const { action } = build({ arcAction: 'Transfer', arcTo: '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739', arcAmount: '25', arcNonce: '9' });
    expect(action.primaryType).toBe('Transfer');
    expect(action.message).toEqual({ to: '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739', amount: '25', nonce: '9' });
    expect(action.types.Transfer.map(field => field.name)).toEqual(['to', 'amount', 'nonce']);
  });

  it('builds 출금 without a recipient, because it has none', () => {
    const { action } = build({ arcAction: 'Withdraw', arcAmount: '7', arcNonce: '2' });
    expect(action.message).toEqual({ amount: '7', nonce: '2' });
    expect(action.types.Withdraw.map(field => field.name)).toEqual(['amount', 'nonce']);
  });

  it('takes a structure of the caller’s own invention, field by field', () => {
    const { action } = build({
      arcAction: 'custom',
      arcCustomName: 'GrantAuthority',
      arcCustomFields: [
        { name: 'agent', type: 'address', value: '0x0000000000000000000000000000000000000001' },
        { name: 'ceiling', type: 'uint256', value: '1000000000' },
        { name: 'memo', type: 'string', value: 'quarterly rebalance only' },
        { name: 'revocable', type: 'bool', value: 'true' },
      ],
    });
    expect(action.primaryType).toBe('GrantAuthority');
    expect(action.message).toEqual({
      agent: '0x0000000000000000000000000000000000000001',
      ceiling: '1000000000',
      memo: 'quarterly rebalance only',
      revocable: true,
    });
  });

  it('fixes the chain and the verifier to the one Arc deployment', () => {
    // Not editable, and not written twice: they come from the same table the
    // proof is later checked against. A different chain or contract would make
    // a proof nothing can verify, and reading that as the circuit failing is
    // the confusion this avoids.
    const { action } = build({});
    expect(action.domain.chainId).toBe(5042002);
    expect(action.domain.verifyingContract).toBe(DEMO_VERIFIERS[CIRCUIT_IDS.ARC_ELIGIBILITY][5042002]);
  });

  it('refuses a value that does not match its declared type, naming the field', () => {
    const custom = { arcAction: 'custom' as const, arcCustomName: 'Grant' };
    expect(() => build({ ...custom, arcCustomFields: [{ name: 'agent', type: 'address', value: '0x01' }] })).toThrow(/agent must be 0x followed by 40 hex/);
    expect(() => build({ ...custom, arcCustomFields: [{ name: 'ceiling', type: 'uint256', value: '1.5' }] })).toThrow(/ceiling must be a whole number/);
    expect(() => build({ ...custom, arcCustomFields: [{ name: 'ok', type: 'bool', value: 'yes' }] })).toThrow(/ok must be true or false/);
    expect(() => build({ ...custom, arcCustomFields: [{ name: 'memo', type: 'string', value: '  ' }] })).toThrow(/memo must not be empty/);
    expect(() => build({ ...custom, arcCustomFields: [{ name: 'id', type: 'bytes32', value: '0xdead' }] })).toThrow(/id must be 0x followed by 64 hex/);
  });

  it('refuses an action with no fields, and one with a name a struct cannot have', () => {
    expect(() => build({ arcAction: 'custom', arcCustomName: 'Grant', arcCustomFields: [] })).toThrow(/at least one field/);
    expect(() => build({ arcAction: 'custom', arcCustomName: '2Grant' })).toThrow(/must start with a letter/);
    expect(() => build({ arcAction: 'custom', arcCustomName: 'Grant', arcCustomFields: [{ name: '', type: 'string', value: 'x' }] })).toThrow(/must start with a letter/);
  });

  it('refuses the same field name twice, which would silently drop one', () => {
    expect(() => build({
      arcAction: 'custom',
      arcCustomName: 'Grant',
      arcCustomFields: [
        { name: 'amount', type: 'uint256', value: '1' },
        { name: 'amount', type: 'uint256', value: '2' },
      ],
    })).toThrow(/'amount' is listed twice/);
  });

  it('refuses an action name the list does not hold, rather than picking one', () => {
    expect(() => build({ arcAction: 'Bridge' as never })).toThrow(/Unknown action 'Bridge'/);
  });

  it('offers no domain fields at all, and no JSON box — only the action', () => {
    const fields = readFileSync(new URL('../app/components/DemoFields.tsx', import.meta.url), 'utf8');
    const arcBlock = fields.slice(fields.indexOf("demo.id === 'arc'"), fields.indexOf("demo.id === 'ownership'"));
    for (const gone of ['arcChainId', 'arcContract', 'arcName', 'arcVersion', 'arcTypes', 'arcMessage', 'arcPrimaryType']) {
      expect(arcBlock).not.toContain(gone);
    }
    expect(arcBlock).toContain('arcCustomFields');
  });

  it('uses the SDK’s validator rather than re-deciding here', () => {
    // Two answers to "is this action valid" is how a dapp comes to be accepted
    // by one layer and refused by the next.
    const source = readFileSync(new URL('../lib/demo-policy.ts', import.meta.url), 'utf8');
    expect(source).toContain('validateTypedAction(action)');
  });
});
