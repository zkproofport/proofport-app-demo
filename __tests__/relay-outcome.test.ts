import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProofportSDK, RELAY_TERMINAL_STATUSES, type RelayProofResult } from '@zkproofport-app/sdk';
import {
  DECLINED_MESSAGE, DEMO_PROOF_WAIT_MS, EXPIRED_MESSAGE, describeFailure, isPendingRelayStatus, isWaitTimeout, settleRelayResult,
} from '../lib/relay-outcome';

/** The relay's own deadline (proofport-relay REQUEST_DEADLINE_MS). Not exported by the SDK, so stated here. */
const RELAY_DEADLINE_MS = 280_000;

const base = { requestId: 'req-1', circuit: 'coinbase_attestation' };
const result = (fields: Record<string, unknown>) => ({ ...base, ...fields }) as unknown as RelayProofResult;

afterEach(() => { vi.unstubAllGlobals(); });

describe('settleRelayResult — one outcome per terminal status', () => {
  it('completed is the only outcome that carries a proof', () => {
    const done = result({ status: 'completed', proof: '0xabcd', publicInputs: ['0x01'] });
    expect(settleRelayResult(done)).toEqual({ kind: 'proof', result: done });
  });

  it('error carries the app message and its error code', () => {
    expect(settleRelayResult(result({ status: 'error', error: 'No attestation found', errorCode: 'E2005' })))
      .toEqual({ kind: 'error', message: 'No attestation found', errorCode: 'E2005' });
  });

  it('error without a code has no errorCode field rather than an empty one', () => {
    const outcome = settleRelayResult(result({ status: 'error', error: 'Sign-in refused' }));
    expect(outcome).toEqual({ kind: 'error', message: 'Sign-in refused' });
    expect('errorCode' in outcome).toBe(false);
  });

  it.each([['empty', ''], ['whitespace', '   \n\t'], ['missing', undefined], ['not a string', 42]])(
    'error with %s text still shows a message', (_label, error) => {
      const outcome = settleRelayResult(result({ status: 'error', error, errorCode: 'E2007' }));
      expect(outcome.kind).toBe('error');
      expect(outcome.kind === 'error' && outcome.message.length).toBeGreaterThan(0);
      expect(outcome.kind === 'error' && outcome.errorCode).toBe('E2007');
    });

  it('a blank errorCode is dropped, not shown as "error code "', () => {
    const outcome = settleRelayResult(result({ status: 'error', error: 'x', errorCode: '  ' }));
    expect(outcome).toEqual({ kind: 'error', message: 'x' });
  });

  it('legacy failed is handled exactly like error', () => {
    expect(settleRelayResult(result({ status: 'failed', error: 'Proof generation failed', errorCode: 'E2001' })))
      .toEqual({ kind: 'error', message: 'Proof generation failed', errorCode: 'E2001' });
  });

  it('cancelled is a decline, never a proof, even if a proof field is present', () => {
    const outcome = settleRelayResult(result({ status: 'cancelled', error: 'User cancelled the request', proof: '0xabcd' }));
    expect(outcome).toEqual({ kind: 'cancelled', message: DECLINED_MESSAGE });
  });

  it('expired is its own outcome', () => {
    expect(settleRelayResult(result({ status: 'expired', error: 'The request timed out before the app answered' })))
      .toEqual({ kind: 'expired', message: EXPIRED_MESSAGE });
  });

  it('maps every status in the SDK terminal list, and only completed to a proof', () => {
    for (const status of RELAY_TERMINAL_STATUSES) {
      const outcome = settleRelayResult(result({ status, proof: '0xabcd' }));
      expect(outcome.kind === 'proof', status).toBe(status === 'completed');
    }
  });
});

describe('settleRelayResult — anything else is an error naming the status', () => {
  it.each([['weird'], ['COMPLETED'], ['Completed '], ['done'], [''], [null], [undefined], [7], ['<img src=x onerror=alert(1)>']])(
    'refuses %j', (status) => {
      expect(() => settleRelayResult(result({ status, proof: '0xabcd' })))
        .toThrow(new RegExp(`unknown status '${String(status).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'.*Known: completed, error, failed, cancelled, expired, pending, generating`));
    });

  it.each([['pending'], ['generating']])('refuses a wait that ended while still %s', (status) => {
    expect(() => settleRelayResult(result({ status }))).toThrow(`still '${status}'`);
  });
});

describe('isPendingRelayStatus', () => {
  it('is true only for the non-terminal statuses', () => {
    expect(isPendingRelayStatus('pending')).toBe(true);
    expect(isPendingRelayStatus('generating')).toBe(true);
    for (const status of [...RELAY_TERMINAL_STATUSES, 'weird', '', undefined, null]) expect(isPendingRelayStatus(status), String(status)).toBe(false);
  });
});

describe('text survives untouched', () => {
  it('keeps Korean, emoji, newlines and markup as plain text, in full', () => {
    const message = '증명 생성에 실패했습니다 🙏\n<script>alert(1)</script>\t%_\\';
    expect(settleRelayResult(result({ status: 'error', error: message }))).toEqual({ kind: 'error', message });
  });

  it('does not shorten a very long message', () => {
    const message = 'x'.repeat(20_000);
    const outcome = settleRelayResult(result({ status: 'error', error: message }));
    expect(outcome.kind === 'error' && outcome.message.length).toBe(20_000);
  });
});

describe('describeFailure', () => {
  it('appends the error code when there is one', () => {
    expect(describeFailure({ kind: 'error', message: 'No attestation found', errorCode: 'E2005' })).toBe('No attestation found (error code E2005)');
    expect(describeFailure({ kind: 'error', message: 'No attestation found' })).toBe('No attestation found');
    expect(describeFailure({ kind: 'cancelled', message: DECLINED_MESSAGE })).toBe(DECLINED_MESSAGE);
  });
});

describe('the wait outlasts the relay', () => {
  it('waits longer than the relay deadline, so the relay answers expired first', () => {
    expect(DEMO_PROOF_WAIT_MS).toBeGreaterThan(RELAY_DEADLINE_MS);
    expect(DEMO_PROOF_WAIT_MS).toBe(300_000);
  });
});

describe('isWaitTimeout recognises the SDK’s own timeout, from the real SDK', () => {
  it('matches what the installed SDK throws when polling runs out', async () => {
    // Real SDK code; only the network is replaced, answering "still pending".
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ requestId: 'req-1', status: 'pending' }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const sdk = new ProofportSDK({ relayUrl: 'http://relay.invalid' });
    const thrown = await sdk.waitForResult('req-1', { intervalMs: 5, timeoutMs: 30 }).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect(isWaitTimeout(thrown)).toBe(true);
  });

  it('matches the socket path message and nothing else', () => {
    expect(isWaitTimeout(new Error('Waiting for proof timed out after 300000ms'))).toBe(true);
    expect(isWaitTimeout(new Error('connect ECONNREFUSED'))).toBe(false);
    expect(isWaitTimeout(new Error('timeout'))).toBe(false);
    expect(isWaitTimeout('Waiting for proof timed out after 1ms')).toBe(false);
    expect(isWaitTimeout(undefined)).toBe(false);
  });
});
