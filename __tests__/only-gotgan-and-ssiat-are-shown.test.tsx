// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DemoTabs, { SHOWN_TABS } from '../app/components/DemoTabs';
import { DEMOS, demoById, type DemoId } from '../lib/demo-catalog';

/**
 * The page shows Gotgan and Ssiat and nothing else. The other demos keep their
 * code, but a visitor gets no tab, no panel and no card for them.
 *
 * `SHOWN_TABS` in app/components/DemoTabs.tsx is the switch. Every test here
 * fails if it lists another tab, or if the navigation or the panels stop
 * reading it.
 */
const SHOWN: DemoId[] = ['giwa', 'ssiat'];
const HIDDEN: DemoId[] = ['kyc', 'country', 'email', 'passport'];
const ALL_DEMOS_MARKER = 'all-demos-page-content';

describe('the switch', () => {
  it('lists exactly Gotgan and Ssiat', () => {
    expect([...SHOWN_TABS]).toEqual(SHOWN);
  });

  it('accounts for every demo in the catalog as either shown or hidden', () => {
    expect(DEMOS.map(demo => demo.id).sort()).toEqual([...SHOWN, ...HIDDEN].sort());
  });
});

describe('the first render (what the server sends)', () => {
  const html = renderToStaticMarkup(<DemoTabs><p>{ALL_DEMOS_MARKER}</p></DemoTabs>);
  const tabIds = [...html.matchAll(/id="demo-tab-([a-z]+)"/g)].map(match => match[1]);
  const panelIds = [...html.matchAll(/id="demo-panel-([a-z]+)"/g)].map(match => match[1]);

  it('has a tab for Gotgan and Ssiat and for nothing else', () => {
    expect(tabIds).toEqual(SHOWN);
    expect(html).toContain('>Gotgan<');
    expect(html).toContain('>Ssiat<');
  });

  it('has a panel for Gotgan and Ssiat and for nothing else', () => {
    expect(panelIds).toEqual(SHOWN);
  });

  it('opens Gotgan', () => {
    expect(html).toContain('data-active="giwa"');
    expect(html).toContain('data-screen="giwa"');
  });

  for (const id of HIDDEN) {
    it(`renders no tab, panel or screen for ${demoById(id)!.tab}`, () => {
      const demo = demoById(id)!;
      expect(html).not.toContain(`id="demo-tab-${id}"`);
      expect(html).not.toContain(`id="demo-panel-${id}"`);
      expect(html).not.toContain(`data-screen="${id}"`);
      expect(html).not.toContain(`>${demo.tab}<`);
      expect(html).not.toContain(demo.headline);
      expect(html).not.toContain(demo.actionTitle);
    });
  }

  it('renders no All demos tab and none of its cards', () => {
    expect(html).not.toContain('id="demo-tab-all"');
    expect(html).not.toContain('id="demo-panel-all"');
    expect(html).not.toContain('All demos');
    expect(html).not.toContain(ALL_DEMOS_MARKER);
  });
});

// Each screen is replaced by its name, so what the tab shell chooses to mount is
// what is read (vi.mock is hoisted, so this applies to the first render above
// too). The real screens are rendered in every-tab-renders.test.tsx.
vi.mock('../app/components/GiwaDemo', () => ({ default: () => <p data-screen="giwa">gotgan-screen</p> }));
vi.mock('../app/components/SsiatDemo', () => ({ default: () => <p data-screen="ssiat">ssiat-screen</p> }));
vi.mock('../app/components/CircuitDemo', () => ({ default: ({ demo }: { demo: { id: string } }) => <p data-screen={demo.id}>{`${demo.id}-screen`}</p> }));
vi.mock('../app/components/AppDownloads', () => ({ default: () => null }));

describe('in the browser', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    // jsdom has no DOMTokenList on <link>.sizes; the shell adds the tab's icon with it.
    if (!('sizes' in HTMLLinkElement.prototype)) {
      Object.defineProperty(HTMLLinkElement.prototype, 'sizes', { configurable: true, get: () => ({ add: () => {} }) });
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  async function open(path: string) {
    window.history.replaceState(null, '', path);
    await act(async () => { root.render(<DemoTabs><p>{ALL_DEMOS_MARKER}</p></DemoTabs>); });
  }
  const tabButtons = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map(button => button.id.replace('demo-tab-', ''));
  const mounted = () => [...host.querySelectorAll('[data-screen]')].map(node => node.getAttribute('data-screen'));
  const visible = () => [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter(panel => !panel.hidden).map(panel => panel.id.replace('demo-panel-', ''));
  async function key(name: string) {
    const focused = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
    await act(async () => { focused.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); });
  }

  it('opens Gotgan with only the Gotgan and Ssiat tabs', async () => {
    await open('/');
    expect(tabButtons()).toEqual(SHOWN);
    expect(visible()).toEqual(['giwa']);
    expect(mounted()).toEqual(['giwa']);
  });

  it('clicking Ssiat shows Ssiat', async () => {
    await open('/');
    await act(async () => { host.querySelector<HTMLButtonElement>('#demo-tab-ssiat')!.click(); });
    expect(visible()).toEqual(['ssiat']);
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('ssiat');
  });

  it('the arrow keys, Home and End move between Gotgan and Ssiat only', async () => {
    await open('/');
    await key('ArrowRight');
    expect(visible()).toEqual(['ssiat']);
    await key('ArrowRight');
    expect(visible()).toEqual(['giwa']);
    await key('ArrowLeft');
    expect(visible()).toEqual(['ssiat']);
    await key('Home');
    expect(visible()).toEqual(['giwa']);
    await key('End');
    expect(visible()).toEqual(['ssiat']);
    expect(mounted().sort()).toEqual([...SHOWN].sort());
  });

  it('an unknown tab in the address opens Gotgan', async () => {
    await open('/?tab=not-a-demo');
    expect(visible()).toEqual(['giwa']);
  });

  // The browser E2E (e2e/relay-outcomes-browser.test.ts) opens ?tab=kyc and
  // ?tab=all to check how a relay request ends, so a hidden tab's address still
  // shows it. The navigation never offers it.
  for (const id of HIDDEN) {
    it(`?tab=${id} shows its screen with no tab for it`, async () => {
      await open(`/?tab=${id}`);
      expect(visible()).toEqual([id]);
      expect(tabButtons()).toEqual(SHOWN);
      expect(host.querySelector('[role="tab"][tabindex="0"]')!.id).toBe('demo-tab-giwa');
    });
  }

  it('?tab=all shows the All demos page with no tab for it', async () => {
    await open('/?tab=all');
    expect(visible()).toEqual(['all']);
    expect(host.textContent).toContain(ALL_DEMOS_MARKER);
    expect(tabButtons()).toEqual(SHOWN);
  });
});
