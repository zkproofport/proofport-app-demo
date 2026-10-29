/**
 * A small client for the kproof-server relay (`/api/v1`, Socket.IO `/proof`).
 *
 * Flow: GET /challenge -> POST /proof/request -> show the deep link -> wait for
 * the answer. The answer arrives over Socket.IO; if the socket cannot connect
 * or drops, the client polls GET /proof/:id instead, so a blocked WebSocket
 * never leaves the page waiting forever.
 */
import { io, type Socket } from 'socket.io-client';

export const TERMINAL = ['completed', 'error', 'cancelled', 'expired'] as const;
export type Terminal = typeof TERMINAL[number];
export type Status = 'pending' | 'generating' | Terminal;

export interface RequestStatus {
  requestId: string;
  status: Status;
  proof?: string;
  publicInputs?: string[];
  error?: string;
  errorCode?: string;
  circuit?: string;
}

export interface CreatedRequest {
  requestId: string;
  deepLink: string;
}

/**
 * Why a relay call failed. `status` is the HTTP status (0 when no answer
 * arrived); `kind` is stable for callers to branch on and translate.
 */
export type RelayErrorKind = 'network' | 'rate_limited' | 'refused' | 'bad_response';

export class RelayError extends Error {
  constructor(readonly status: number, readonly kind: RelayErrorKind, message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

export function isTerminal(status: string): status is Terminal {
  return (TERMINAL as readonly string[]).includes(status);
}

type Fetch = typeof fetch;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function call(fetchImpl: Fetch, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    throw new RelayError(0, 'network', `Cannot reach the relay: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await readJson(res);
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : res.statusText;
    if (res.status === 429) throw new RelayError(429, 'rate_limited', `Rate limited by the relay: ${reason}`);
    throw new RelayError(res.status, 'refused', `The relay refused the call (HTTP ${res.status}): ${reason}`);
  }
  return body;
}

function parseStatus(body: Record<string, unknown>, requestId: string): RequestStatus {
  const status = body.status;
  if (typeof status !== 'string' || !(['pending', 'generating', ...TERMINAL] as string[]).includes(status)) {
    throw new RelayError(0, 'bad_response', `The relay sent an unknown status: ${String(status)}`);
  }
  return {
    requestId,
    status: status as Status,
    ...(typeof body.proof === 'string' && { proof: body.proof }),
    ...(Array.isArray(body.publicInputs) && { publicInputs: body.publicInputs.filter((p): p is string => typeof p === 'string') }),
    ...(typeof body.error === 'string' && { error: body.error }),
    ...(typeof body.errorCode === 'string' && { errorCode: body.errorCode }),
    ...(typeof body.circuit === 'string' && { circuit: body.circuit }),
  };
}

export interface RelayClientOptions {
  apiUrl: string;
  fetchImpl?: Fetch;
  connect?: (url: string) => Socket;
  pollIntervalMs?: number;
}

export class RelayClient {
  private readonly apiUrl: string;
  private readonly api: string;
  private readonly fetchImpl: Fetch;
  private readonly connect: (url: string) => Socket;
  private readonly pollIntervalMs: number;

  constructor(options: RelayClientOptions) {
    this.apiUrl = options.apiUrl;
    this.api = `${options.apiUrl}/api/v1`;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.connect = options.connect ?? ((url) => io(`${url}/proof`, { path: '/socket.io', transports: ['websocket', 'polling'] }));
    this.pollIntervalMs = options.pollIntervalMs ?? 3000;
  }

  async createRequest(circuitId: string, inputs: Record<string, unknown>, dappName: string): Promise<CreatedRequest> {
    const challenge = await call(this.fetchImpl, `${this.api}/challenge`);
    if (typeof challenge.requestId !== 'string' || typeof challenge.challenge !== 'string') {
      throw new RelayError(0, 'bad_response', 'The challenge answer has no requestId or challenge');
    }
    const body = await call(this.fetchImpl, `${this.api}/proof/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: challenge.requestId,
        challenge: challenge.challenge,
        circuitId,
        inputs,
        ...(typeof inputs.scope === 'string' && { scope: inputs.scope }),
        dappName,
      }),
    });
    if (typeof body.requestId !== 'string' || typeof body.deepLink !== 'string') {
      throw new RelayError(0, 'bad_response', 'The request answer has no requestId or deepLink');
    }
    return { requestId: body.requestId, deepLink: body.deepLink };
  }

  async getStatus(requestId: string): Promise<RequestStatus> {
    const body = await call(this.fetchImpl, `${this.api}/proof/${encodeURIComponent(requestId)}`);
    return parseStatus(body, requestId);
  }

  /**
   * Calls `onUpdate` with every status until a terminal one, then stops.
   * Returns a function that stops waiting early.
   */
  watch(requestId: string, onUpdate: (s: RequestStatus) => void, onError: (e: Error) => void): () => void {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let socket: Socket | undefined;

    const finish = () => {
      done = true;
      if (timer) clearTimeout(timer);
      socket?.disconnect();
    };
    const emit = (s: RequestStatus) => {
      if (done) return;
      onUpdate(s);
      if (isTerminal(s.status)) finish();
    };

    const poll = async () => {
      if (done) return;
      try {
        emit(await this.getStatus(requestId));
      } catch (err) {
        if (err instanceof RelayError && err.status === 404) {
          emit({ requestId, status: 'expired', error: 'The request expired or is no longer on the relay' });
          return;
        }
        if (err instanceof RelayError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          finish();
          onError(err);
          return;
        }
        // Network trouble or 5xx/429: keep polling.
      }
      if (!done) timer = setTimeout(poll, this.pollIntervalMs);
    };

    try {
      socket = this.connect(this.apiUrl);
      socket.on('connect', () => socket?.emit('proof:subscribe', { requestId }));
      socket.on('proof:status', (data: unknown) => {
        if (data && typeof data === 'object' && (data as { requestId?: unknown }).requestId === requestId) {
          try { emit(parseStatus(data as Record<string, unknown>, requestId)); } catch { /* polling covers it */ }
        }
      });
      socket.on('proof:result', (data: unknown) => {
        if (data && typeof data === 'object' && (data as { requestId?: unknown }).requestId === requestId) {
          try { emit(parseStatus(data as Record<string, unknown>, requestId)); } catch { /* polling covers it */ }
        }
      });
    } catch {
      socket = undefined;
    }
    // Polling runs alongside the socket: the socket makes updates fast, the
    // poll makes them certain.
    void poll();
    return finish;
  }
}
