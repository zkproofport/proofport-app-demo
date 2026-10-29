import { DEFAULT_RELAY_WAIT_MS, RELAY_TERMINAL_STATUSES, isTerminalRelayStatus, type RelayProofResult, type RelayProofStatus, type RelayTerminalStatus } from '@zkproofport-app/sdk';

/**
 * How long the demo waits for a relay answer.
 *
 * The relay ends every unanswered request itself at 540 s with an `expired`
 * result, delivered over the socket and to polling. Waiting longer than that is
 * what lets the relay's answer arrive first; the SDK's own timeout (this value)
 * is then only the fallback for a relay or socket that has stopped answering.
 * The value is the SDK's own default wait (600 000 ms), taken from the SDK so
 * the two cannot drift apart; `__tests__/relay-outcome.test.ts` pins it above
 * the relay's deadline.
 *
 * It used to be 180 000 at six call sites, so the demo gave up 100 s before the
 * relay would have told it what happened.
 */
export const DEMO_PROOF_WAIT_MS = DEFAULT_RELAY_WAIT_MS;

/** What a finished relay request means for the page. */
export type RelayOutcome =
  | { kind: 'proof'; result: RelayProofResult }
  | { kind: 'error'; message: string; errorCode?: string }
  | { kind: 'cancelled'; message: string }
  | { kind: 'expired'; message: string };

export const DECLINED_MESSAGE = 'The request was declined in the ZKProofport app. Nothing was shared.';
export const EXPIRED_MESSAGE = 'The ZKProofport app did not answer in time, so the request expired.';
export const NO_RELAY_ANSWER_MESSAGE = `No answer came back from the relay within ${DEMO_PROOF_WAIT_MS / 60_000} minutes. Check your connection and try again.`;
const APP_ERROR_MESSAGE = 'The ZKProofport app could not generate the proof.';

/**
 * Statuses a request passes through before it ends. Checked against the SDK in
 * both directions: a status that is not one of the SDK's non-terminal ones
 * fails `satisfies`, and one the SDK adds without a row here fails `_allPending`.
 */
const RELAY_PENDING_STATUSES = ['pending', 'generating'] as const satisfies readonly Exclude<RelayProofStatus, RelayTerminalStatus>[];
type UnlistedPending = Exclude<Exclude<RelayProofStatus, RelayTerminalStatus>, (typeof RELAY_PENDING_STATUSES)[number]>;
const _allPending: [UnlistedPending] extends [never] ? true : never = true;
void _allPending;

/** True while a request is still on its way to an answer; for code that drives `pollResult()` itself. */
export function isPendingRelayStatus(status: unknown): boolean {
  return (RELAY_PENDING_STATUSES as readonly unknown[]).includes(status);
}

type StatusLike = Pick<RelayProofResult, 'error' | 'errorCode'> & { status?: unknown };

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function appError(result: StatusLike): RelayOutcome {
  const errorCode = text(result.errorCode);
  const message = text(result.error) ?? APP_ERROR_MESSAGE;
  return errorCode ? { kind: 'error', message, errorCode } : { kind: 'error', message };
}

/**
 * One row per terminal status the SDK names. `Record<RelayTerminalStatus, …>`
 * means a status the SDK adds does not build until it has a row here.
 */
const OUTCOMES: Record<RelayTerminalStatus, (result: RelayProofResult) => RelayOutcome> = {
  completed: result => ({ kind: 'proof', result }),
  error: appError,
  // Older app versions send `failed` for what is now `error`.
  failed: appError,
  cancelled: () => ({ kind: 'cancelled', message: DECLINED_MESSAGE }),
  expired: () => ({ kind: 'expired', message: EXPIRED_MESSAGE }),
};

function unknownStatus(status: unknown): Error {
  return new Error(
    `The relay answered with an unknown status '${String(status)}'. ` +
      `Known: ${[...RELAY_TERMINAL_STATUSES, ...RELAY_PENDING_STATUSES].join(', ')}.`,
  );
}

/**
 * The outcome of the result `waitForProof()` resolved with. That promise only
 * settles on a terminal status, so a pending status here is as wrong as an
 * unknown one, and both throw with the status named.
 */
export function settleRelayResult(result: RelayProofResult | StatusLike): RelayOutcome {
  const status = result.status;
  if (typeof status === 'string' && isTerminalRelayStatus(status)) return OUTCOMES[status](result as RelayProofResult);
  if (isPendingRelayStatus(status)) {
    throw new Error(`The relay wait ended while the request was still '${String(status)}'.`);
  }
  throw unknownStatus(status);
}

/**
 * True when `waitForProof()` rejected because its own timer ran out — the
 * relay or socket never answered at all. The SDK says so only in its message
 * ("Waiting for proof timed out after …ms" / "Polling timed out after …ms").
 */
export function isWaitTimeout(cause: unknown): boolean {
  return cause instanceof Error && /timed out after \d+ms/.test(cause.message);
}

/** The text the demo shows for a failed request, error code included when the app sent one. */
export function describeFailure(outcome: Exclude<RelayOutcome, { kind: 'proof' }>): string {
  return outcome.kind === 'error' && outcome.errorCode ? `${outcome.message} (error code ${outcome.errorCode})` : outcome.message;
}
