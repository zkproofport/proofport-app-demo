/**
 * Verifies a KProof answer against the request that asked for it.
 *
 * Every check is listed in the outcome, passed or not, so a caller can show
 * exactly why an answer was refused. An answer is `valid` only when every
 * check passes.
 *
 * What this does NOT establish yet: that the ID data inside the proof came
 * from the government. The mobile ID circuits do not check an issuer
 * signature today (the KOMSCO message spec is not read yet), so `issuerVerified`
 * is always false and a proof shows that the prover KNEW data satisfying the
 * statement, not that a government issued it.
 */
import { getBytes, keccak256 } from 'ethers';
const keccak_256 = (bytes: Uint8Array) => getBytes(keccak256(`0x${toHex(bytes)}`));
import { lookupCircuit, lookupNetwork, type CircuitId, type CircuitLayout, type Environment } from './circuits';
import { checkAge, checkRegion, checkText } from './requests';

export type VerificationMethod = 'onchain' | 'offchain';

export interface VerifyRequest {
  circuitId: CircuitId;
  /** The `inputs` the request was created with (`buildInputs`). */
  inputs: Record<string, unknown>;
}

export interface VerifyAnswer {
  status: string;
  circuit?: string;
  proof?: string;
  publicInputs?: string[];
}

export interface Check {
  name: 'status' | 'circuit' | 'public_input_count' | 'public_input_format' | 'scope' | 'age_threshold' | 'current_year' | 'region' | 'on_chain' | 'off_chain';
  ok: boolean;
  detail: string;
}

export interface VerifyOutcome {
  valid: boolean;
  method: VerificationMethod;
  checks: Check[];
  /** 0x-prefixed 32-byte nullifier, present when the public inputs could be read. */
  nullifier?: string;
  issuerVerified: false;
  network: { chainId: number; verifier: string };
}

export interface VerifyOptions {
  method?: VerificationMethod;
  environment: Environment;
  /** Clock for the current-year check; defaults to the real clock. */
  now?: Date;
  fetchImpl?: typeof fetch;
}

const WORD_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
/** keccak256("verify(bytes,bytes32[])")[:4] — the same selector circuits/scripts/verify-onchain.sh uses. */
const VERIFY_SELECTOR = 'ea50d0e4';
const REGION_BYTES = 64;

const utf8 = (s: string) => new TextEncoder().encode(s);
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** keccak256 of the UTF-8 scope string: what the app puts in the `scope` public input. */
export function scopeHash(scope: string): Uint8Array {
  return keccak_256(utf8(scope));
}

/** keccak256 of the si/do name zero-padded to 64 bytes: the `region_code` public input. */
export function regionHash(region: string): Uint8Array {
  const bytes = utf8(region);
  if (bytes.length > REGION_BYTES) throw new Error(`region name is ${bytes.length} bytes, more than ${REGION_BYTES}`);
  const padded = new Uint8Array(REGION_BYTES);
  padded.set(bytes);
  return keccak_256(padded);
}

/** The calendar year in Korea (UTC+9, no daylight saving) at `date`. */
export function koreanYear(date: Date): number {
  return new Date(date.getTime() + 9 * 3600_000).getUTCFullYear();
}

function wordValue(word: string): bigint {
  return BigInt(word);
}

/** `count` one-byte words starting at `offset`, as bytes; throws when a word is not a byte. */
export function readBytes(words: readonly string[], offset: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const word = words.at(offset + i);
    if (word === undefined) throw new Error(`public input ${offset + i} is missing`);
    const v = wordValue(word);
    if (v > BigInt(255)) throw new Error(`public input ${offset + i} is ${word}, not a single byte`);
    out[i] = Number(v);
  }
  return out;
}

function readNumber(words: readonly string[], offset: number): bigint {
  const word = words.at(offset);
  if (word === undefined) throw new Error(`public input ${offset} is missing`);
  return wordValue(word);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** ABI-encodes verify(bytes proof, bytes32[] publicInputs). */
export function encodeVerifyCall(proofHex: string, publicInputs: readonly string[]): string {
  const proof = proofHex.slice(2);
  const word = (n: number) => n.toString(16).padStart(64, '0');
  const proofLen = proof.length / 2;
  const proofPadded = proof + '0'.repeat((64 - (proof.length % 64)) % 64);
  const proofPart = word(proofLen) + proofPadded;
  const inputsPart = word(publicInputs.length) + publicInputs.map((w) => w.slice(2).toLowerCase()).join('');
  const head = word(64) + word(64 + proofPart.length / 2);
  return `0x${VERIFY_SELECTOR}${head}${proofPart}${inputsPart}`;
}

/** eth_call to the circuit's verifier. True only for an explicit `true` return. */
export async function verifyOnChain(
  rpcUrl: string,
  verifier: string,
  proofHex: string,
  publicInputs: readonly string[],
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<{ ok: boolean; detail: string }> {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: verifier, data: encodeVerifyCall(proofHex, publicInputs) }, 'latest'] }),
  });
  if (!res.ok) throw new Error(`RPC ${rpcUrl} answered HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: unknown } };
  if (body.error) return { ok: false, detail: `verifier reverted: ${String(body.error.message)}` };
  if (typeof body.result !== 'string') throw new Error(`RPC ${rpcUrl} returned no result`);
  const ok = /^0x0*1$/.test(body.result);
  return { ok, detail: ok ? 'verifier returned true' : `verifier returned ${body.result}` };
}

function check(checks: Check[], name: Check['name'], fn: () => string): boolean {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
    return true;
  } catch (err) {
    checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function circuitChecks(checks: Check[], id: CircuitId, layout: CircuitLayout, words: string[], inputs: Record<string, unknown>, now: Date): void {
  check(checks, 'scope', () => {
    const expected = scopeHash(checkText('scope', inputs.scope));
    if (!sameBytes(readBytes(words, layout.scope, 32), expected)) throw new Error('the proof was made for a different scope');
    return 'matches the request';
  });
  if (id === 'mdl_kr_age') {
    const ageField = layout.extra.ageThreshold!;
    const yearField = layout.extra.currentYear!;
    check(checks, 'age_threshold', () => {
      const want = BigInt(checkAge(inputs.ageThreshold));
      const got = readNumber(words, ageField.offset);
      if (got !== want) throw new Error(`the proof is for age ${got}, the request asked ${want}`);
      return `age ${want}`;
    });
    check(checks, 'current_year', () => {
      // The app proves with its own clock. Accept this Korean year, and last
      // year only within a day of New Year, so a proof made at 23:59 on
      // 31 December still verifies a minute later.
      const got = readNumber(words, yearField.offset);
      const thisYear = BigInt(koreanYear(now));
      const dayAgo = BigInt(koreanYear(new Date(now.getTime() - 86_400_000)));
      if (got !== thisYear && got !== dayAgo) throw new Error(`the proof uses year ${got}, not ${thisYear}`);
      return `year ${got}`;
    });
  }
  if (id === 'mdl_kr_region') {
    const field = layout.extra.regionCode!;
    check(checks, 'region', () => {
      const region = checkRegion(inputs.targetRegion);
      if (!sameBytes(readBytes(words, field.offset, field.words), regionHash(region))) throw new Error(`the proof is not for ${region}`);
      return region;
    });
  }
}

export async function verifyAnswer(request: VerifyRequest, answer: VerifyAnswer, options: VerifyOptions): Promise<VerifyOutcome> {
  const method = options.method ?? 'onchain';
  if (method !== 'onchain' && method !== 'offchain') throw new Error('Unknown verification method');
  const network = lookupNetwork(options.environment);
  const { id, layout } = lookupCircuit(request.circuitId);
  const verifier = network.verifiers[id];
  const checks: Check[] = [];
  const outcome = (nullifier?: string): VerifyOutcome => ({
    valid: checks.length > 0 && checks.every((c) => c.ok),
    method,
    checks,
    ...(nullifier !== undefined && { nullifier }),
    issuerVerified: false,
    network: { chainId: network.chainId, verifier },
  });

  if (!check(checks, 'status', () => {
    if (answer.status !== 'completed') throw new Error(`the answer is '${answer.status}', not 'completed'`);
    return 'completed';
  })) return outcome();
  check(checks, 'circuit', () => {
    if (answer.circuit !== id) throw new Error(`the answer is for '${String(answer.circuit)}', the request asked '${id}'`);
    return id;
  });
  const words = answer.publicInputs;
  if (!check(checks, 'public_input_count', () => {
    if (!Array.isArray(words)) throw new Error('the answer has no public inputs');
    if (words.length !== layout.publicInputs) throw new Error(`${words.length} public inputs, ${id} has ${layout.publicInputs}`);
    return `${words.length}`;
  }) || !words) return outcome();
  if (!check(checks, 'public_input_format', () => {
    const bad = words.findIndex((w) => typeof w !== 'string' || !WORD_RE.test(w));
    if (bad !== -1) throw new Error(`public input ${bad} is not a 32-byte hex word`);
    if (typeof answer.proof !== 'string' || !HEX_RE.test(answer.proof) || answer.proof.length <= 2) throw new Error('the proof is not 0x-prefixed hex');
    return 'ok';
  })) return outcome();

  let nullifier: string | undefined;
  try {
    nullifier = `0x${toHex(readBytes(words, layout.nullifier, 32))}`;
  } catch {
    nullifier = undefined;
  }
  circuitChecks(checks, id, layout, words, request.inputs, options.now ?? new Date());

  // A valid proof for another policy never authorizes this checkout, on either path.
  if (checks.some(c => !c.ok)) return outcome(nullifier);
  try {
    if (method === 'offchain') {
      const { verifyOffChain } = await import('./offchain');
      const result = await verifyOffChain(id, answer.proof, words, { fetchImpl: options.fetchImpl });
      checks.push({ name: 'off_chain', ok: result.valid, detail: result.valid ? 'verified locally against the pinned key' : 'local verifier rejected the proof' });
    } else {
      const result = await verifyOnChain(network.rpcUrl, verifier, answer.proof!, words, options.fetchImpl);
      checks.push({ name: 'on_chain', ok: result.ok, detail: result.detail });
    }
  } catch (err) {
    checks.push({ name: method === 'offchain' ? 'off_chain' : 'on_chain', ok: false, detail: `could not verify: ${err instanceof Error ? err.message : String(err)}` });
  }
  return outcome(nullifier);
}
