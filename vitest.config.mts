import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Tests render components, so they need JSX turned into calls.
 *
 * `tsconfig.json` says `"jsx": "preserve"`, which is correct for Next — its own
 * compiler does the transform. Vitest reads that same setting and so hands
 * untransformed JSX to the parser, which fails on the first `<`. This says
 * "transform it here" and changes nothing about what Next sees.
 */
export default defineConfig({
  // The same `@/` that tsconfig gives Next, so a component imports identically
  // in a test and in the app.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
  // `e2e/` needs a running relay and is run by `npm run test:e2e`.
  test: { environment: 'node', exclude: ['node_modules/**', 'e2e/**'] },
});
