import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ALL_CIRCUIT_IDS, CIRCUIT_IDS } from '@zkproofport-app/sdk';

/** vitest runs with the package root as cwd. */
const PAGE_PATH = join(process.cwd(), 'app', 'page.tsx');
const page = readFileSync(PAGE_PATH, 'utf8');

/**
 * The demo asks for circuits by the SDK's constant, never by a typed-out string.
 *
 * Circuit ids are the one value that has to be spelled identically in the
 * circuit, the SDK, the demo, the mobile app and the relay. A typo does not
 * fail loudly — it produces a nullifier that does not match, or a verifier
 * lookup that finds nothing, both of which surface far from the typo.
 *
 * The demo's other guard counts `createRelayRequest` call sites without ever
 * naming a circuit, so before this file a renamed circuit broke nothing here.
 *
 * These cases are text-based on purpose. Importing the page would drag in React
 * and the whole client bundle to answer a question about what is written in it.
 */
describe('circuit ids in the demo come from the SDK', () => {
  it('never passes a circuit id as a literal string', () => {
    // Only the code, so the rendered code SAMPLE further down the page — which
    // shows a customer the literal on purpose — is not mistaken for a call.
    const code = page
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');

    const offenders: string[] = [];
    for (const id of ALL_CIRCUIT_IDS) {
      // A quoted id passed as an argument, i.e. followed by a comma or a paren.
      const asArgument = new RegExp(`['"\`]${id}['"\`]\\s*[,)]`);
      if (asArgument.test(code)) offenders.push(id);
    }
    expect(offenders).toEqual([]);
  });

  it('uses the constant at every relay request', () => {
    const calls = page.match(/createRelayRequest\(\s*([^,]+),/g) || [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // Either the constant directly, or a variable that was assigned from it
      // (the mDL variant ternary does that).
      expect(call).toMatch(/CIRCUIT_IDS\.|createRelayRequest\(\s*circuit\s*,/);
    }
  });

  it('the constants it names actually exist in the SDK', () => {
    const named = [...page.matchAll(/CIRCUIT_IDS\.([A-Z_]+)/g)].map(m => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const key of new Set(named)) {
      expect(Object.keys(CIRCUIT_IDS)).toContain(key);
    }
  });
});
