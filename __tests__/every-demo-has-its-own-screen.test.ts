import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMOS } from '../lib/demo-catalog';

/**
 * Every demo has a screen of its own. None inherits another circuit's.
 *
 * The screen component ended with an unconditional `return` that rendered the
 * Korea Mobile ID layout, so any circuit matching none of the branches above it
 * got that screen. Arc did, on 2026-09-12: its tab opened on "Your Korean ID.
 * Only the answer.", listed name, date of birth and street address as the
 * fields being withheld, and offered Ownership / Age check / Region buttons —
 * beside a form asking for a deposit amount on Arc.
 *
 * Nothing failed. The page rendered, the proof request worked, and the words
 * were about a different product.
 */
const source = readFileSync(
  join(__dirname, '..', 'app', 'components', 'DemoExperience.tsx'),
  'utf8',
);

describe('every demo has its own screen', () => {
  it('names a branch for each demo in the catalog', () => {
    const missing = DEMOS.map(demo => demo.id).filter(
      id => !source.includes(`demo.id === '${id}'`),
    );
    // The three Korea Mobile ID variants share one screen, named together in
    // its guard rather than each getting a branch.
    const shared = ['ownership', 'age', 'region'];
    expect(missing.filter(id => !shared.includes(id))).toEqual([]);
    for (const id of shared) {
      expect(source).toContain(`demo.id !== '${id}'`);
    }
  });

  it('has no unconditional return that would catch an unmatched circuit', () => {
    // A bare `return <>` at the end is the shape that made Arc Korean.
    const guarded = source.indexOf("if (demo.id !== 'ownership'");
    const lastReturn = source.lastIndexOf('  return <>');
    expect(guarded).toBeGreaterThan(-1);
    expect(lastReturn).toBeGreaterThan(guarded);
  });

  it('refuses a circuit with no screen instead of showing another one', () => {
    expect(source).toMatch(/throw new Error\([\s\S]{0,120}No demo screen for/);
  });

  it('gives Arc its own words, not the Korean ID ones', () => {
    // The branch's MARKUP only. The comment above the Korea Mobile ID guard
    // explains the bug and names its screen, so including comments made this
    // check fail on its own explanation.
    const withComments = source.slice(
      source.indexOf("if (demo.id === 'arc')"),
      source.indexOf("if (demo.id !== 'ownership'"),
    );
    const arcBranch = withComments.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(arcBranch).toContain('Let an agent move money');
    expect(arcBranch).toContain('Coinbase KYC');
    // The Korean ID screen's own copy must not appear here.
    expect(arcBranch).not.toContain('Your Korean ID');
    expect(arcBranch).not.toContain('Korean mobile ID');
    // "Age check" appears only in the Korea Mobile ID screen's own buttons.
    expect(arcBranch).not.toMatch(/Age check|Ownership.*Region/);
  });
});
