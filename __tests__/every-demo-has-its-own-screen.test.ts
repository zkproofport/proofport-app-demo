import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMOS } from '../lib/demo-catalog';
import { DEDICATED_SCREENS } from '../app/components/DemoTabs';

/**
 * Every demo has a screen of its own. None inherits another circuit's.
 *
 * The screen component ended with an unconditional `return` that rendered one
 * demo's identity layout, so any circuit matching none of the branches above it
 * got that screen. On 2026-09-12 a new tab did: it opened on another product's
 * headline, listed name, date of birth and street address as the fields being
 * withheld, and offered that product's predicate buttons — beside a form asking
 * for a deposit amount.
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
    expect(missing).toEqual([]);
  });

  it('ends in an error, not an unconditional return that would catch an unmatched circuit', () => {
    // A bare `return <>` at the end is the shape that gave a new tab another demo's screen.
    const refusal = source.lastIndexOf('No demo screen for');
    const lastReturn = source.lastIndexOf(' return <>');
    expect(refusal).toBeGreaterThan(-1);
    expect(lastReturn).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(lastReturn);
    // Every `return <>` is the body of an `if (demo.id === …)`.
    const returns = source.match(/^ {2}(?:if \(demo\.id === '\w+'\) )?return <>/gm) ?? [];
    expect(returns.length).toBeGreaterThan(0);
    for (const line of returns) expect(line).toMatch(/if \(demo\.id === '\w+'\) return <>/);
  });

  it('refuses a circuit with no screen instead of showing another one', () => {
    expect(source).toMatch(/throw new Error\([\s\S]{0,120}No demo screen for/);
  });
});
