/**
 * Checks a KProof proof against its circuit's verification key, with no chain
 * and no RPC: the same mathematical check the deployed verifier contract makes,
 * run where the caller is (a browser tab, a server).
 *
 * Kept out of the package index on purpose. The verifier is a large WebAssembly
 * module, loaded by dynamic import on the first call, so a caller that never
 * verifies off-chain never downloads it, and the mobile app, which verifies
 * natively, never bundles it.
 *
 * Three things must match how the app proves, or a good proof fails:
 *
 *  - The verifier build: `@aztec/bb.js` at exactly BB_VERSION from
 *    circuits/toolchain.env (4.2.0-aztecnr-rc.2), the barretenberg the app's
 *    prover links.
 *  - The flavour: the app proves for the EVM target (keccak transcript, ZK),
 *    so the check is `verifierTarget: 'evm'`. Other flavours answer false for a
 *    good proof or fail outright.
 *  - The key: bundled under public/kproof/vk from the pinned source below,
 *    served from this app, and refused unless its SHA-256 matches `CIRCUITS`
 *    -- the key the deployed verifiers embed.
 */
import { getBytes, sha256 as ethersSha256 } from 'ethers';
const sha256 = (bytes: Uint8Array) => getBytes(ethersSha256(`0x${toHex(bytes)}`));
import { lookupCircuit, type CircuitId } from './circuits';

/** Provenance of the bundled verification keys; runtime downloads use the same origin. */
export const VK_SOURCE = {
  repo: 'masselabs/kproof',
  commit: '2eecca9958c4527765111386645e1654408eb3a0',
  root: 'circuits/',
} as const;

/** Largest proof accepted, in bytes. The KProof circuits' proofs are 8768 and 9920 bytes. */
export const MAX_PROOF_BYTES = 65_536;

const WORD_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})+$/;

/**
 * The two structured reference string points the check uses, so nothing has to
 * be downloaded for it: the BN254 G1 generator, and the G2 point of the
 * ceremony the circuits were set up with (bb's `bn254_g2.dat`). The G2 limbs
 * are the "G2 point from VK" constants in every generated verifier contract
 * (circuits/mdl/kr-*\/target/*.sol); a test holds them equal.
 */
export const SRS_G1 =
  '0000000000000000000000000000000000000000000000000000000000000001' +
  '0000000000000000000000000000000000000000000000000000000000000002';
export const SRS_G2 =
  '0118c4d5b837bcc2bc89b5b398b5974e9f5944073b32078b7e231fec938883b0' +
  '260e01b251f6f1c7e7ff4e580791dee8ea51d87a358e038b4efe30fac09383c1' +
  '22febda3c0c0632a56475b4214e5615e11e6dd3f96e6cea2854a87d4dacc5e55' +
  '04fc6369f7110fe3d25156c1bb9a72859cf2a04641f99ba4ee413c80da6a5fe4';

export interface OffChainResult {
  /** True only when the proof verified against the pinned key. */
  valid: boolean;
  /** Milliseconds the whole check took, including loading the verifier and the key on first use. */
  ms: number;
}

/** What the check needs from the verifier module; the shape of `@aztec/bb.js` this file uses. */
export interface VerifierModule {
  BarretenbergSync: { new: (options: { backend: never }) => Promise<VerifierApi> };
  BackendType: { Wasm: unknown };
  UltraHonkVerifierBackend: new (api: VerifierApi) => {
    verifyProof(
      data: { proof: Uint8Array; publicInputs: string[]; verificationKey: Uint8Array },
      options: { verifierTarget: 'evm' },
    ): Promise<boolean>;
  };
}
interface VerifierApi {
  srsInitSrs(input: { pointsBuf: Uint8Array; numPoints: number; g2Point: Uint8Array }): unknown;
}

export interface OffChainOptions {
  fetchImpl?: typeof fetch;
  /** Milliseconds before a key download is abandoned. Default 30000. */
  timeoutMs?: number;
  /** @internal Test seam: loads the verifier module instead of the dynamic import. */
  loadVerifier?: () => Promise<VerifierModule>;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

/** Same-origin URL of a bundled, hash-pinned verification key. */
export function vkUrl(circuitId: CircuitId): string {
  lookupCircuit(circuitId);
  return `/kproof/vk/${circuitId}.bin`;
}

const vkCache = new Map<CircuitId, Promise<Uint8Array>>();

async function downloadKey(id: CircuitId, expected: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Uint8Array> {
  const url = vkUrl(id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`could not download the verification key (HTTP ${res.status}) from ${url}`);
    const key = new Uint8Array(await res.arrayBuffer());
    const got = toHex(sha256(key));
    if (got !== expected) throw new Error(`the verification key from ${url} has sha256 ${got}, expected ${expected}`);
    return key;
  } finally {
    clearTimeout(timer);
  }
}

/** The pinned key for a circuit, downloaded once per page and checked against its digest. */
function verificationKey(id: CircuitId, expected: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<Uint8Array> {
  let pending = vkCache.get(id);
  if (!pending) {
    pending = downloadKey(id, expected, fetchImpl, timeoutMs);
    vkCache.set(id, pending);
    pending.catch(() => vkCache.delete(id));
  }
  return pending;
}

let verifierPromise: Promise<{ backend: InstanceType<VerifierModule['UltraHonkVerifierBackend']> }> | undefined;

async function createVerifier(load: () => Promise<VerifierModule>) {
  let bb: VerifierModule;
  try {
    bb = await load();
  } catch (err) {
    throw new Error(`could not load the proof verifier: ${err instanceof Error ? err.message : String(err)}`);
  }
  const api = await bb.BarretenbergSync.new({ backend: bb.BackendType.Wasm as never });
  api.srsInitSrs({ pointsBuf: hexToBytes(`0x${SRS_G1}`), numPoints: 1, g2Point: hexToBytes(`0x${SRS_G2}`) });
  return { backend: new bb.UltraHonkVerifierBackend(api) };
}

/** One verifier per page, created on first use; a failed start is forgotten so the next call retries. */
function verifier(load: () => Promise<VerifierModule>) {
  if (!verifierPromise) {
    verifierPromise = createVerifier(load);
    verifierPromise.catch(() => {
      verifierPromise = undefined;
    });
  }
  return verifierPromise;
}

const defaultLoad = () => import('@aztec/bb.js') as unknown as Promise<VerifierModule>;

/** Throws when the proof or the public inputs cannot be what this circuit produces. */
function checkShape(id: CircuitId, publicInputCount: number, proof: unknown, publicInputs: unknown): asserts proof is string {
  if (typeof proof !== 'string' || !HEX_RE.test(proof)) throw new Error('the proof is not 0x-prefixed hex');
  const bytes = (proof.length - 2) / 2;
  if (bytes > MAX_PROOF_BYTES) throw new Error(`the proof is ${bytes} bytes, more than ${MAX_PROOF_BYTES}`);
  if (bytes % 32 !== 0) throw new Error(`the proof is ${bytes} bytes, not a whole number of 32-byte fields`);
  if (!Array.isArray(publicInputs)) throw new Error('the public inputs are not a list');
  if (publicInputs.length !== publicInputCount) throw new Error(`${publicInputs.length} public inputs, ${id} has ${publicInputCount}`);
  const bad = publicInputs.findIndex((w) => typeof w !== 'string' || !WORD_RE.test(w));
  if (bad !== -1) throw new Error(`public input ${bad} is not a 32-byte hex word`);
}

/**
 * Verifies `proof` with `publicInputs` against the pinned key of `circuitId`.
 *
 * Resolves `{ valid }` once the check ran: `valid` is false for a proof that
 * does not verify. Rejects when the check could not run, with the reason: an
 * unknown circuit (naming the known ones), a proof or public inputs of the
 * wrong shape, a key that cannot be downloaded or does not match its digest,
 * or a verifier that cannot be loaded.
 */
export async function verifyOffChain(circuitId: unknown, proof: unknown, publicInputs: unknown, options: OffChainOptions = {}): Promise<OffChainResult> {
  const started = Date.now();
  const { id, layout } = lookupCircuit(circuitId);
  checkShape(id, layout.publicInputs, proof, publicInputs);
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const [key, { backend }] = await Promise.all([
    verificationKey(id, layout.vkSha256, fetchImpl, options.timeoutMs ?? 30_000),
    verifier(options.loadVerifier ?? defaultLoad),
  ]);
  let valid: boolean;
  try {
    valid = await backend.verifyProof(
      { proof: hexToBytes(proof), publicInputs: (publicInputs as string[]).map((w) => w.toLowerCase()), verificationKey: key },
      { verifierTarget: 'evm' },
    );
  } catch (err) {
    // A proof the verifier cannot even parse can leave its memory in any state; start the next check fresh.
    verifierPromise = undefined;
    throw new Error(`the verifier could not check this proof: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { valid: valid === true, ms: Date.now() - started };
}

/** @internal Test seam: forget cached keys and the loaded verifier. */
export function resetOffChainVerifier(): void {
  vkCache.clear();
  verifierPromise = undefined;
}
