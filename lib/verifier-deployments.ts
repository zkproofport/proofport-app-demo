import { CIRCUIT_IDS, getPinnedVariantVerifier, getPinnedVerifier, resolveSignerVariant, type SignerVariant } from '@zkproofport-app/sdk';

/**
 * Which verifier deployments this demo accepts a proof against: per circuit,
 * the chains a returned proof may name.
 *
 * Neither the ADDRESS nor the deployment record is written here. Both come
 * from the pinned table in `@zkproofport-app/core` (re-exported by the SDK),
 * the same table every SDK verify path uses, so the demo cannot drift onto a
 * verifier the SDK would refuse. `__tests__/verifier-deployments.test.ts` reads
 * each pinned row's `record` in the circuits repository and fails when core's
 * address and the record disagree.
 */
export const VERIFIER_DEPLOYMENTS: Record<string, readonly number[]> = {
  [CIRCUIT_IDS.GIWA_ATTESTATION]: [91342],
  [CIRCUIT_IDS.DOJANG_PLAYGROUND]: [91342],
  [CIRCUIT_IDS.COINBASE_ATTESTATION]: [8453, 84532],
  [CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION]: [8453, 84532],
  [CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: [8453, 84532],
  [CIRCUIT_IDS.HUMAN_PASSPORT_SCORE]: [8453, 84532],
};

const own = (table: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(table, key);

function acceptedChain(circuit: string, chainId: number): void {
  if (!own(VERIFIER_DEPLOYMENTS, circuit)) {
    throw new Error(`No verifier table for circuit '${circuit}'. Known: ${Object.keys(VERIFIER_DEPLOYMENTS).join(', ')}.`);
  }
  const chains = VERIFIER_DEPLOYMENTS[circuit];
  if (!Number.isSafeInteger(chainId) || !chains.includes(chainId)) {
    throw new Error(`No ${circuit} verifier on chain ${String(chainId)}. Known chains: ${chains.join(', ')}.`);
  }
}

/**
 * The standard package's verifier for one circuit on one chain: core's pinned
 * deployment, provided the demo accepts that circuit on that chain. Anything
 * else is an error naming what is missing.
 */
export function verifierAddress(circuit: string, chainId: number): string {
  acceptedChain(circuit, chainId);
  return getPinnedVerifier(circuit, chainId).address;
}

/**
 * The package that made a proof (`standard`, or an Android signer's), as the
 * SDK resolves it from the result's claim and the proof's length. A claim the
 * circuit has no package for, or one the length contradicts, is an error.
 */
export function proofSignerVariant(circuit: string, claimed: unknown, proofHex: unknown): SignerVariant {
  const resolved = resolveSignerVariant(circuit, claimed as string | undefined, proofHex as string);
  if ('error' in resolved) throw new Error(resolved.error);
  return resolved.variant;
}

/**
 * The `uint8 signerVariant` argument the Gotgan vault and the Ssiat drop take
 * beside every proof: which of their three compiled-in verifiers checks it
 * (contracts/src/GiwaDemoVault.sol and SsiatDrop.sol, `SIGNER_*`).
 */
const SIGNER_VARIANT_ARGUMENTS: Readonly<Record<SignerVariant, number>> = Object.freeze({
  standard: 0,
  android: 1,
  android_factory: 2,
});

/** The contract argument for a package. A value with no row is an error, never another package's number. */
export function signerVariantArgument(variant: unknown): number {
  if (typeof variant !== 'string' || !own(SIGNER_VARIANT_ARGUMENTS, variant)) {
    throw new Error(`Unknown signer variant '${String(variant)}'. Known: ${Object.keys(SIGNER_VARIANT_ARGUMENTS).join(', ')}.`);
  }
  return SIGNER_VARIANT_ARGUMENTS[variant as SignerVariant];
}

/** The verifier for one package of one circuit on one accepted chain. */
export function variantVerifierAddress(circuit: string, chainId: number, variant: SignerVariant): string {
  acceptedChain(circuit, chainId);
  return getPinnedVariantVerifier(circuit, variant, chainId).address;
}
