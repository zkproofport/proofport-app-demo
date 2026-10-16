// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CIRCUIT_IDS } from '@zkproofport-app/sdk';
import LandingPage from '../app/page';
import CircuitDemo from '../app/components/CircuitDemo';
import { DEMOS, demoById, type DemoId } from '../lib/demo-catalog';
import { CARD_SCOPES, LIVE_SECTION_SCOPES, cardScope, liveSectionScope } from '../lib/demo-scopes';

/**
 * The relay counts requests per scope, so the scope is what tells one demo's
 * traffic from another's on its dashboard. Every request names its demo, the
 * name is the same on every request from that demo, and no two demos share one.
 * The scope used to be one string for the whole lower section and a fresh
 * random value per request in the cards, so the dashboard could tell nothing.
 */
const external = vi.hoisted(() => ({ create: vi.fn(), qr: vi.fn(), wait: vi.fn(), signer: vi.fn(), disconnect: vi.fn() }));
vi.mock('../lib/sdk', () => ({ createSDK: () => ({ setSigner: external.signer, createRelayRequest: external.create, generateQRCode: external.qr, waitForProof: external.wait, disconnect: external.disconnect }) }));
vi.mock('../app/components/DemoTabs', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('ethers', async importOriginal => {
  const ethers = await importOriginal<typeof import('ethers')>();
  return { ...ethers, ethers: { ...ethers.ethers, Wallet: { createRandom: () => new ethers.Wallet('0x' + '01'.repeat(32)) } } };
});

const ALL = [...Object.values(CARD_SCOPES), ...Object.values(LIVE_SECTION_SCOPES)];
// The relay's per-scope counter stores at most this many characters (proofport-relay/src/labels.ts).
const RELAY_SCOPE_MAX_CHARS = 128;

describe('the scope table', () => {
  it('names every demo card in the catalog', () => {
    expect(Object.keys(CARD_SCOPES).sort()).toEqual(DEMOS.map(demo => demo.id).sort());
  });

  it('gives no two requests the same scope', () => {
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  it.each(ALL)('%s is readable, short enough for the relay to count, and marked as the demo', scope => {
    expect(scope.startsWith('zkproofport-demo:')).toBe(true);
    expect(scope).toMatch(/^[a-z0-9:-]+$/);
    expect(scope.length).toBeLessThanOrEqual(RELAY_SCOPE_MAX_CHARS);
  });

  it('refuses a demo or circuit it has no row for, naming it', () => {
    expect(() => cardScope('madang' as DemoId)).toThrow("No scope for demo 'madang'");
    expect(() => liveSectionScope(CIRCUIT_IDS.DOJANG_PLAYGROUND)).toThrow(`No scope for circuit '${CIRCUIT_IDS.DOJANG_PLAYGROUND}'`);
    expect(() => liveSectionScope('')).toThrow("No scope for circuit ''");
    expect(() => liveSectionScope('__proto__')).toThrow("No scope for circuit '__proto__'");
  });
});

let host: HTMLDivElement;
let root: Root;
async function render(node: React.ReactNode) {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  external.create.mockResolvedValue({ requestId: 'req-scope', deepLink: 'zkproofport://proof-request?test=1' });
  external.qr.mockResolvedValue('data:image/png;base64,test');
  external.wait.mockResolvedValue({ requestId: 'req-scope', status: 'cancelled' });
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(node); });
}
afterEach(async () => {
  if (!root) return;
  await act(async () => { root.unmount(); }); host.remove(); vi.unstubAllGlobals();
});
const sent = () => external.create.mock.calls.map(([circuit, inputs]) => ({ circuit, scope: inputs.scope }));

describe('every demo card sends its own scope, the same one each time', () => {
  // Gotgan and Ssiat have screens of their own whose scope a contract decides.
  const cards = DEMOS.filter(demo => demo.id !== 'giwa' && demo.id !== 'ssiat');
  it.each(cards.map(demo => demo.id))('%s', async id => {
    const demo = demoById(id)!;
    await render(<CircuitDemo demo={demo} onSelect={() => {}} />);
    for (let i = 0; i < 2; i++) {
      await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    }
    expect(sent()).toEqual([
      { circuit: demo.circuit, scope: CARD_SCOPES[id] },
      { circuit: demo.circuit, scope: CARD_SCOPES[id] },
    ]);
  });
});

describe('every panel of the live section sends its own scope', () => {
  async function press(panel: string, label = 'Request') {
    const button = [...host.querySelectorAll(`#demo-${panel} button`)].find(b => b.textContent?.includes(label)) as HTMLButtonElement;
    expect(button, `no "${label}" button on ${panel}`).toBeTruthy();
    await act(async () => { button.click(); });
  }

  it.each([
    ['kyc', CIRCUIT_IDS.COINBASE_ATTESTATION],
    ['country', CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION],
    ['email', CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION],
    ['giwa', CIRCUIT_IDS.GIWA_ATTESTATION],
  ] as const)('%s', async (panel, circuit) => {
    await render(<LandingPage />);
    await press(panel);
    expect(sent()).toEqual([{ circuit, scope: LIVE_SECTION_SCOPES[circuit] }]);
  });

  it.each([
    ['Ownership', CIRCUIT_IDS.MDL_KR_OWNERSHIP],
    ['Age', CIRCUIT_IDS.MDL_KR_AGE],
    ['Region', CIRCUIT_IDS.MDL_KR_REGION],
  ] as const)('Korea Mobile ID, %s', async (variant, circuit) => {
    await render(<LandingPage />);
    await press('mdl', variant);
    await press('mdl', 'Request Proof');
    expect(sent()).toEqual([{ circuit, scope: LIVE_SECTION_SCOPES[circuit] }]);
  });
});
