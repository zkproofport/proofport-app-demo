import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The tests that need a relay answering over HTTP.
 *
 * Kept out of `npm test` because a machine with no relay would fail them for a
 * reason that says nothing about the code. `npm run test:e2e` runs them, and
 * names the relay it is talking to.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  test: { environment: 'node', include: ['e2e/**/*.test.ts'] },
});
