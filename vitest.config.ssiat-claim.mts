import base, { SSIAT_CLAIM_E2E } from './vitest.config.e2e.mts';

/**
 * The real Ssiat claim alone (see the header of e2e/ssiat-claim.test.ts for
 * the SSIAT_E2E_* variables it needs). It is kept out of `npm run test:e2e`
 * because it waits for a person to approve a proof on a phone.
 */
export default { ...base, test: { ...base.test, include: [SSIAT_CLAIM_E2E], exclude: ['**/node_modules/**'] } };
