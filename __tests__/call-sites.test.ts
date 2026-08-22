import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/** vitest runs with the package root as cwd. */
const PAGE_PATH = join(process.cwd(), 'app', 'page.tsx');

/**
 * Contract-invocation guard.
 *
 * `returnScheme` is invisible end to end if a single request forgets to ask for
 * it, and nothing else in the suite would notice: the SDK, the relay and the
 * app all treat an absent field as a legitimate "no app switch". So this test
 * reads the page source and asserts every relay request routes the decision
 * through `getReturnSchemeForRequest()` — a fifth proof card added later
 * without it fails here.
 */

const PAGE = readFileSync(PAGE_PATH, 'utf-8');
const CALL = 'sdk.createRelayRequest(';

/** Source of each `sdk.createRelayRequest(...)` call, up to its closing `});`. */
function callSites(source: string): string[] {
  const sites: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(CALL, from);
    if (start === -1) return sites;
    const end = source.indexOf('});', start);
    expect(end, 'unterminated createRelayRequest call').toBeGreaterThan(start);
    sites.push(source.slice(start, end + 3));
    from = end;
  }
}

describe('app/page.tsx — every relay request decides on returnScheme', () => {
  const sites = callSites(PAGE);

  it('still has the four proof requests this demo ships', () => {
    // Not an upper bound: a fifth card is fine, it just has to pass the next
    // assertion too.
    expect(sites.length).toBeGreaterThanOrEqual(4);
  });

  it.each(sites.map((site, i) => [i, site] as const))(
    'call site %i passes returnScheme',
    (_i, site) => {
      expect(site).toContain('returnScheme: getReturnSchemeForRequest()');
    },
  );

  it('imports the helper rather than inlining a literal', () => {
    expect(PAGE).toContain(
      "import { getReturnSchemeForRequest } from '@/lib/returnScheme'",
    );
  });

  it('hardcodes no environment origin as a return target', () => {
    for (const site of sites) {
      expect(site).not.toMatch(/returnScheme:\s*['"`]/);
    }
  });
});

describe('app/page.tsx — one device predicate, not two', () => {
  it('imports isMobileDevice from lib/device instead of re-declaring it', () => {
    expect(PAGE).toContain("import { isMobileDevice } from '@/lib/device'");
    expect(PAGE).not.toMatch(/function\s+isMobileDevice/);
  });

  it('does not sniff the user agent anywhere else on the page', () => {
    expect(PAGE).not.toContain('navigator.userAgent');
  });
});
