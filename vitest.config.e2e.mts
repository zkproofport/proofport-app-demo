import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export const SSIAT_CLAIM_E2E = 'e2e/ssiat-claim.test.ts';

/**
 * The tests that need a relay answering over HTTP.
 *
 * Kept out of `npm test` because a machine with no relay would fail them for a
 * reason that says nothing about the code. `npm run test:e2e` runs them, and
 * names the relay it is talking to.
 *
 * `e2e/ssiat-claim.test.ts` is excluded: it is a real claim that waits for a
 * person to approve a proof on a phone and needs a funded recipient key, so it
 * refuses to load without SSIAT_E2E_* and failed every plain `npm run test:e2e`
 * run. It has its own command, `npm run test:e2e:ssiat-claim`
 * (vitest.config.ssiat-claim.mts).
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: { environment: 'node', include: ['e2e/**/*.test.ts'], exclude: ['**/node_modules/**', SSIAT_CLAIM_E2E] },
});
