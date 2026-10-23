import { CIRCUIT_IDS } from '@zkproofport-app/sdk';

/**
 * The one table of verifier contracts this demo accepts a proof against.
 *
 * `record` is where the address lives in the circuits repository: a
 * `deployments/<chainId>/<Name>.json` file, or, for Base mainnet, whose
 * deployment files are not committed, the `broadcast/<Script>/8453/run-latest.json`
 * transaction. `__tests__/verifier-deployments.test.ts` reads those files and
 * fails when this table and the records disagree, so a redeploy cannot leave
 * the demo pointing at a retired verifier without anyone noticing.
 */
export type VerifierDeployment = { address: string; record: string };

export const VERIFIER_DEPLOYMENTS: Record<string, Record<number, VerifierDeployment>> = {
  [CIRCUIT_IDS.GIWA_ATTESTATION]: {
    91342: { address: '0xf6edb9d6114b2546b6e559997fdde08caeea83b3', record: 'deployments/91342/GiwaAttestation.json' },
  },
  [CIRCUIT_IDS.DOJANG_PLAYGROUND]: {
    91342: { address: '0xad6c9bfa60f3ee618dee9dc2027a69c57f2ad816', record: 'deployments/91342/DojangPlayground.json' },
  },
  [CIRCUIT_IDS.COINBASE_ATTESTATION]: {
    8453: { address: '0xf7ded73e7a7fc8fb030c35c5a88d40abe6865382', record: 'broadcast/DeployCoinbaseAttestation.s.sol/8453/run-latest.json' },
    84532: { address: '0x42d165a48256ae184e1de4e7e6372e870e2bc883', record: 'deployments/84532/CoinbaseAttestation.json' },
  },
  [CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION]: {
    8453: { address: '0xf3d5a09d2c85b28c52ef2905c1be3a852b609d0c', record: 'broadcast/DeployCoinbaseCountryAttestation.s.sol/8453/run-latest.json' },
    84532: { address: '0x9deea2189ae694d7a36f65fb7d7dbe9f75abddce', record: 'deployments/84532/CoinbaseCountryAttestation.json' },
  },
  [CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: {
    8453: { address: '0x9677ba46ad226ce8b3c4517d9c0143e4d458beae', record: 'broadcast/DeployOidcDomainAttestation.s.sol/8453/run-latest.json' },
    84532: { address: '0x5d9ece4f0276d12693f79659760a68011efef485', record: 'deployments/84532/OidcDomainAttestation.json' },
  },
  [CIRCUIT_IDS.MDL_KR_OWNERSHIP]: {
    84532: { address: '0x49c03b925583aa8528bbfba5a1a4e1f9b157c95a', record: 'deployments/84532/MdlKrOwnership.json' },
  },
  [CIRCUIT_IDS.MDL_KR_AGE]: {
    84532: { address: '0x45d4850a9b197ceba185b5069fb13ce0be1dc6d6', record: 'deployments/84532/MdlKrAge.json' },
  },
  [CIRCUIT_IDS.MDL_KR_REGION]: {
    84532: { address: '0x044116df792eb424c9648df2deeda97afa617ac0', record: 'deployments/84532/MdlKrRegion.json' },
  },
};

/** The verifier address for one circuit on one chain, or an error naming what is missing. */
export function verifierAddress(circuit: string, chainId: number): string {
  const byChain = VERIFIER_DEPLOYMENTS[circuit];
  if (!byChain) throw new Error(`No verifier table for circuit '${circuit}'. Known: ${Object.keys(VERIFIER_DEPLOYMENTS).join(', ')}.`);
  const row = byChain[chainId];
  if (!row) throw new Error(`No ${circuit} verifier on chain ${chainId}. Known chains: ${Object.keys(byChain).join(', ')}.`);
  return row.address;
}
