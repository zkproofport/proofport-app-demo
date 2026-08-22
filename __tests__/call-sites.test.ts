import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/** vitest runs with the package root as cwd. */
const PAGE_PATH = join(process.cwd(), 'app', 'page.tsx');

/**
 * Contract-invocation guard, inverted.
 *
 * This file used to assert that every relay request passed a `returnScheme`.
 * It now asserts the opposite, and the reason matters enough to write down
 * where the next person will hit it.
 *
 * `returnScheme` names an APP for ZKProofport to bring back to the foreground.
 * This demo is a web page; it has no app, so it has nothing valid to send. It
 * used to send `window.location.origin`, which on a real device made
 * ZKProofport open `https://demo.zkproofport.app` — and iOS handed that to the
 * browser, which opened a NEW TAB on a freshly loaded page. The tab the user
 * started in, and the live relay socket waiting for the proof, were abandoned.
 * The https-origin form is now rejected by the relay, the SDK and the app.
 *
 * With nothing sent, the SDK fills in `googlechrome://` when the page is
 * running in Chrome for iOS (the one browser with a scheme that foregrounds
 * without navigating), Android backgrounds the ZKProofport app so the browser
 * resumes untouched, and everywhere else the user is told the proof was
 * delivered and to switch back themselves.
 *
 * So these assertions exist to stop an origin being reintroduced by someone who
 * reads its absence as an oversight.
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

describe('app/page.tsx — no relay request names a return target', () => {
  const sites = callSites(PAGE);

  it('still has the four proof requests this demo ships', () => {
    // Not an upper bound: a fifth card is fine, it just has to pass the rest.
    expect(sites.length).toBeGreaterThanOrEqual(4);
  });

  it.each(sites.map((site, i) => [i, site] as const))(
    'call site %i passes no returnScheme option',
    (_i, site) => {
      // Comments mentioning the field are fine and in fact required; an actual
      // `returnScheme:` property is not.
      const withoutComments = site.replace(/\/\/[^\n]*/g, '');
      expect(withoutComments).not.toMatch(/returnScheme\s*:/);
    },
  );

  it('hardcodes no origin as a return target anywhere on the page', () => {
    const withoutComments = PAGE.replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toMatch(/returnScheme\s*:/);
    expect(withoutComments).not.toContain('demo.zkproofport.app');
  });

  it('no longer imports a return-target helper', () => {
    expect(PAGE).not.toContain('getReturnSchemeForRequest');
    expect(PAGE).not.toContain("from '@/lib/returnScheme'");
  });

  it('keeps the explanation of why nothing is sent', () => {
    // The module that used to hold this reasoning is deleted. If the comment
    // goes too, the next person reads the absence as a bug and "fixes" it.
    expect(PAGE).toContain('DELIBERATE');
    expect(PAGE).toContain('googlechrome://');
    expect(PAGE).toContain('moveTaskToBack');
  });
});

describe('lib/returnScheme.ts — deleted, and staying deleted', () => {
  it('does not exist', () => {
    // It derived an https origin, which is exactly the form that is now
    // rejected end to end. Reviving it would revive the new-tab bug.
    expect(existsSync(join(process.cwd(), 'lib', 'returnScheme.ts'))).toBe(false);
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
