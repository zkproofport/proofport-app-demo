import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMOS } from '../lib/demo-catalog';
import { DEDICATED_SCREENS } from '../app/components/DemoTabs';

/**
 * Every demo has a screen of its own. None inherits another circuit's.
 *
 * The screen component ended with an unconditional `return` that rendered the
 * Korea Mobile ID layout, so any circuit matching none of the branches above it
 * got that screen. On 2026-09-12 a new tab did: it opened on "Your Korean ID.
 * Only the answer.", listed name, date of birth and street address as the
 * fields being withheld, and offered Ownership / Age check / Region buttons —
 * beside a form asking for a deposit amount.
 *
 * Nothing failed. The page rendered, the proof request worked, and the words
 * were about a different product.
 */
const source = readFileSync(
  join(__dirname, '..', 'app', 'components', 'DemoExperience.tsx'),
  'utf8',
);

describe('every demo has its own screen', () => {
  it('names a branch for each demo in the catalog, or gives it a dedicated screen', () => {
    // Gotgan and Ssiat render their own component (DEDICATED_SCREENS in DemoTabs)
    // and never reach DemoExperience.
    const missing = DEMOS.map(demo => demo.id).filter(
      id => !source.includes(`demo.id === '${id}'`) && !DEDICATED_SCREENS[id],
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
    // A bare `return <>` at the end is the shape that gave a new tab the Korean ID screen.
    const guarded = source.indexOf("if (demo.id !== 'ownership'");
    const lastReturn = source.lastIndexOf('  return <>');
    expect(guarded).toBeGreaterThan(-1);
    expect(lastReturn).toBeGreaterThan(guarded);
  });

  it('refuses a circuit with no screen instead of showing another one', () => {
    expect(source).toMatch(/throw new Error\([\s\S]{0,120}No demo screen for/);
  });
});
