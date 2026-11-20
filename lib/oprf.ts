import { checkOprfProof, OPRF_PUBLIC_INPUT_LAYOUTS, readOprfPublicInputs, type OprfEnvironment } from '@zkproofport-app/core';

/**
 * The domain every demo request keys its OPRF nullifier by, beside its scope.
 *
 * Passed explicitly rather than left to the SDK's page-hostname default: the
 * Gotgan vault and the Ssiat drop pin this exact string on chain
 * (`OPRF_DOMAIN()`), so a proof requested from staging, a local stack or a LAN
 * address must carry the same domain to be accepted, and a person keeps the
 * same nullifier wherever the demo is opened.
 */
export const DEMO_OPRF_DOMAIN = 'demo.zkproofport.app';

/**
 * Whose OPRF key a proof from each chain must carry: a testnet verifier's
 * proofs come from the test network key, a mainnet one's from production.
 * Keyed; a chain with no row is an error, never another chain's environment.
 */
const CHAIN_OPRF_ENVIRONMENTS: Readonly<Record<number, OprfEnvironment>> = Object.freeze({
  8453: 'production',
  84532: 'staging',
  91342: 'staging',
});

export function oprfEnvironmentForChain(chainId: number): OprfEnvironment {
  const environment = Object.hasOwn(CHAIN_OPRF_ENVIRONMENTS, chainId) ? CHAIN_OPRF_ENVIRONMENTS[chainId] : undefined;
  if (!environment) throw new Error(`No OPRF environment for chain ${chainId}. Known: ${Object.keys(CHAIN_OPRF_ENVIRONMENTS).join(', ')}.`);
  return environment;
}

/** Whether a circuit publishes an OPRF nullifier (every wallet credential does; OIDC does not). */
export function hasOprfNullifier(circuit: string): boolean {
  if (!Object.hasOwn(OPRF_PUBLIC_INPUT_LAYOUTS, circuit)) {
    throw new Error(`Unknown circuit '${circuit}'. Known: ${Object.keys(OPRF_PUBLIC_INPUT_LAYOUTS).join(', ')}.`);
  }
  return (OPRF_PUBLIC_INPUT_LAYOUTS as Record<string, unknown>)[circuit] !== null;
}

/**
 * Check a wallet credential proof's OPRF public inputs against the request:
 * the key hash pinned for the proof's chain, and the domain and scope the
 * request named. All three comparisons are core's (`checkOprfProof`); the
 * nullifier is read with core's layout, never recomputed here.
 *
 * @returns the proof's nullifier, as 0x + 64 hex.
 * @throws Error with core's reason for anything that does not match.
 */
export function checkDemoOprfProof(
  circuit: string, chainId: number, publicInputs: readonly string[], request: { scope: string; oprfDomain: string },
): string {
  const checked = checkOprfProof(circuit, publicInputs, { oprfEnvironment: oprfEnvironmentForChain(chainId), request });
  if (!checked.ok) throw new Error(checked.error);
  return readOprfPublicInputs(circuit, publicInputs).nullifier;
}
