import { CIRCUIT_IDS } from '@zkproofport-app/sdk';
import type { DemoId } from './demo-catalog';

/**
 * The scope every demo request carries, written out so the relay's per-scope
 * statistics name the demo a request came from. A scope is fixed per demo, as
 * a real dApp's is: the same person gets the same nullifier there each time,
 * and a proof made for one demo does not match another.
 *
 * Two flows are not here, because a contract decides their scope and the proof
 * is bound to it: the Gotgan deposit (GiwaDemoVault.depositScope, one per
 * deposit) and the Ssiat claim (SsiatDrop.claimScope, one per drop).
 */

/** The demo cards at the top of the page, by demo id. */
export const CARD_SCOPES: Record<DemoId, string> = {
  giwa: 'zkproofport-demo:gotgan:giwa',
  ssiat: 'zkproofport-demo:ssiat:ssiat',
  kyc: 'zkproofport-demo:common:kyc',
  country: 'zkproofport-demo:borderless:country',
  email: 'zkproofport-demo:zk-blind:email',
  ownership: 'zkproofport-demo:korean-mobile-id:ownership',
  age: 'zkproofport-demo:korean-mobile-id:age',
  region: 'zkproofport-demo:korean-mobile-id:region',
};

/** The "Try it live." section further down, by the circuit each panel requests. */
export const LIVE_SECTION_SCOPES = {
  [CIRCUIT_IDS.COINBASE_ATTESTATION]: 'zkproofport-demo:try-it-live:kyc',
  [CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION]: 'zkproofport-demo:try-it-live:country',
  [CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: 'zkproofport-demo:try-it-live:email',
  [CIRCUIT_IDS.MDL_KR_OWNERSHIP]: 'zkproofport-demo:try-it-live:mdl-ownership',
  [CIRCUIT_IDS.MDL_KR_AGE]: 'zkproofport-demo:try-it-live:mdl-age',
  [CIRCUIT_IDS.MDL_KR_REGION]: 'zkproofport-demo:try-it-live:mdl-region',
  [CIRCUIT_IDS.GIWA_ATTESTATION]: 'zkproofport-demo:try-it-live:giwa',
} as const;

export function cardScope(id: DemoId): string {
  const scope = Object.hasOwn(CARD_SCOPES, id) ? CARD_SCOPES[id] : undefined;
  if (!scope) throw new Error(`No scope for demo '${id}'. Known: ${Object.keys(CARD_SCOPES).join(', ')}.`);
  return scope;
}

export function liveSectionScope(circuit: string): string {
  const scope = Object.hasOwn(LIVE_SECTION_SCOPES, circuit) ? (LIVE_SECTION_SCOPES as Record<string, string>)[circuit] : undefined;
  if (!scope) throw new Error(`No scope for circuit '${circuit}' in the live section. Known: ${Object.keys(LIVE_SECTION_SCOPES).join(', ')}.`);
  return scope;
}
