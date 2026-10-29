import { CIRCUIT_IDS, getPinnedVerifier } from '@zkproofport-app/sdk';

/**
 * Which verifier deployments this demo accepts a proof against: per circuit,
 * the chains a returned proof may name.
 *
 * The ADDRESS is not written here. It comes from the pinned table in
 * `@zkproofport-app/core` (re-exported by the SDK), the same table every SDK
 * verify path uses, so the demo cannot drift onto a verifier the SDK would
 * refuse. Until core 0.2.0 this file held its own copy of every address.
 *
 * `record` is where the deployment lives in the circuits repository: a
 * `deployments/<chainId>/<Name>.json` file, or, for Base mainnet, whose
 * deployment files are not committed, the `broadcast/<Script>/8453/run-latest.json`
 * transaction. `__tests__/verifier-deployments.test.ts` reads those files and
 * fails when core's pinned address and the record disagree, so a redeploy that
 * core has not caught up with is noticed here.
 */
export const VERIFIER_DEPLOYMENTS: Record<string, Record<number, { record: string }>> = {
  [CIRCUIT_IDS.GIWA_ATTESTATION]: {
    91342: { record: 'deployments/91342/GiwaAttestation.json' },
  },
  [CIRCUIT_IDS.DOJANG_PLAYGROUND]: {
    91342: { record: 'deployments/91342/DojangPlayground.json' },
  },
  [CIRCUIT_IDS.COINBASE_ATTESTATION]: {
    8453: { record: 'broadcast/DeployCoinbaseAttestation.s.sol/8453/run-latest.json' },
    84532: { record: 'deployments/84532/CoinbaseAttestation.json' },
  },
  [CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION]: {
    8453: { record: 'broadcast/DeployCoinbaseCountryAttestation.s.sol/8453/run-latest.json' },
    84532: { record: 'deployments/84532/CoinbaseCountryAttestation.json' },
  },
  [CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: {
    8453: { record: 'broadcast/DeployOidcDomainAttestation.s.sol/8453/run-latest.json' },
    84532: { record: 'deployments/84532/OidcDomainAttestation.json' },
  },
};

const own = (table: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(table, key);

/**
 * The verifier address for one circuit on one chain: core's pinned deployment,
 * provided the demo accepts that circuit on that chain. Anything else is an
 * error naming what is missing.
 */
export function verifierAddress(circuit: string, chainId: number): string {
  if (!own(VERIFIER_DEPLOYMENTS, circuit)) {
    throw new Error(`No verifier table for circuit '${circuit}'. Known: ${Object.keys(VERIFIER_DEPLOYMENTS).join(', ')}.`);
  }
  const byChain = VERIFIER_DEPLOYMENTS[circuit];
  if (!Number.isSafeInteger(chainId) || !own(byChain, chainId)) {
    throw new Error(`No ${circuit} verifier on chain ${String(chainId)}. Known chains: ${Object.keys(byChain).join(', ')}.`);
  }
  return getPinnedVerifier(circuit, chainId).address;
}
