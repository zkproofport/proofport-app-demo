/**
 * The Korea Mobile ID circuits KProof answers for, keyed by the canonical id
 * from each circuit's Nargo.toml. One table; an id not in it is refused by
 * name, never mapped to another circuit.
 *
 * Public inputs are a flat array of 32-byte words fixed by each circuit's ABI
 * (`circuits/mdl/kr-*` in this repository): every `[u8; 32]` is 32 words
 * of one byte each, every `u8`/`u32` is one word.
 */
export type CircuitId = 'mdl_kr_ownership' | 'mdl_kr_age' | 'mdl_kr_region';

export interface CircuitLayout {
  /** The circuit's directory under circuits/ (its compiled files are in <dir>/target). */
  dir: string;
  /**
   * SHA-256 of the circuit's verification key (`<dir>/target/vk/vk`), the key
   * every deployed verifier below embeds. Off-chain verification refuses any
   * other key.
   */
  vkSha256: string;
  /** Total number of public input words. */
  publicInputs: number;
  /** Word offsets of each named public input. */
  scope: number;
  nullifier: number;
  /** Circuit-specific fields after the nullifier. */
  extra: Readonly<Record<string, { offset: number; words: number }>>;
}

export const CIRCUITS: Readonly<Record<CircuitId, CircuitLayout>> = {
  mdl_kr_ownership: {
    dir: 'mdl/kr-ownership',
    vkSha256: '5a8ffb281836e1090f3f3362687d4fc088ef6b0a413a5c46fa869377071bba82',
    publicInputs: 97,
    scope: 0,
    nullifier: 32,
    extra: { discloseFlags: { offset: 64, words: 1 }, ownerCommit: { offset: 65, words: 32 } },
  },
  mdl_kr_age: {
    dir: 'mdl/kr-age',
    vkSha256: 'b3207f9767612cf404ae48457c1dd2cf5fe600c71459a4381888de44656cb353',
    publicInputs: 66,
    scope: 0,
    nullifier: 32,
    extra: { ageThreshold: { offset: 64, words: 1 }, currentYear: { offset: 65, words: 1 } },
  },
  mdl_kr_region: {
    dir: 'mdl/kr-region',
    vkSha256: 'd4a51be6959c5e10f93ac93b7a9fc6a8fa44c6e71730e43456c5e3a33b5cddde',
    publicInputs: 96,
    scope: 0,
    nullifier: 32,
    extra: { regionCode: { offset: 64, words: 32 } },
  },
};

export function lookupCircuit(id: unknown): { id: CircuitId; layout: CircuitLayout } {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(CIRCUITS, id)) {
    throw new Error(`Unknown circuit '${String(id)}'. Known: ${Object.keys(CIRCUITS).join(', ')}.`);
  }
  return { id: id as CircuitId, layout: CIRCUITS[id as CircuitId] };
}

/**
 * Where each circuit's proofs are checked on chain, per KProof environment.
 * Addresses come from zkproofport/circuits deployment records (circuits commit
 * 35a8df4, Base Sepolia, 2026-10-22); the fixture proofs in `fixtures/` verify
 * against them (circuits `scripts/verify-onchain.sh`, 2026-10-27).
 *
 * There is no production row yet: asking for it throws instead of reusing the
 * staging contracts.
 */
export interface Network {
  chainId: number;
  name: string;
  rpcUrl: string;
  /** The kproof-server relay origin for this environment. */
  relayUrl: string;
  verifiers: Readonly<Record<CircuitId, string>>;
}

export const NETWORKS = {
  staging: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    relayUrl: 'https://stg-api.koreanproof.com',
    verifiers: {
      mdl_kr_ownership: '0x49c03b925583aa8528bbfba5a1a4e1f9b157c95a',
      mdl_kr_age: '0x45d4850a9b197ceba185b5069fb13ce0be1dc6d6',
      mdl_kr_region: '0x044116df792eb424c9648df2deeda97afa617ac0',
    },
  },
} as const satisfies Record<string, Network>;

export type Environment = keyof typeof NETWORKS;

export function lookupNetwork(environment: unknown): Network {
  if (typeof environment !== 'string' || !Object.prototype.hasOwnProperty.call(NETWORKS, environment)) {
    throw new Error(`Unknown KProof environment '${String(environment)}'. Known: ${Object.keys(NETWORKS).join(', ')}.`);
  }
  return NETWORKS[environment as Environment];
}
