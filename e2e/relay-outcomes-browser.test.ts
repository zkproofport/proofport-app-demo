/**
 * How a request ends, seen in a real (headless) browser against the running
 * demo and relay containers.
 *
 * The browser opens the demo, starts a proof request, and this test plays the
 * phone: it posts the app's callback to the relay exactly as ZKProofport does
 * (`POST /api/v1/proof/callback`). The relay pushes the terminal result to the
 * page over its socket, and the page must show it promptly.
 *
 * Headless Chromium through playwright-core; nothing touches the host screen
 * or cursor. Install the browser once, in this package:
 *   npx playwright-core install chromium-headless-shell
 *
 * Run with the dev stack up (./scripts/dev.sh), the demo container rebuilt:
 *   DEMO_URL=http://localhost:3300 RELAY_URL=http://localhost:4001 npm run test:e2e
 *
 * The page talks to the relay on port 4001 of the host it was opened on
 * (lib/sdk.ts), so DEMO_URL must be a local address and RELAY_URL the relay on
 * that host; the test checks that the browser's request reached RELAY_URL.
 *
 * DEMO_E2E_EXPIRY=1 also waits for the relay's own deadline (about 280 s) and
 * checks the page shows the expired ending. Off by default because of the wait.
 *
 * Screenshots go to a fresh temporary directory, printed at the end; set
 * DEMO_E2E_SCREENSHOT_DIR to choose one. Never inside the repository.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { DECLINED_MESSAGE, EXPIRED_MESSAGE } from '../lib/relay-outcome';

const demoUrl = process.env.DEMO_URL;
const relayUrl = process.env.RELAY_URL;
if (!demoUrl) throw new Error('DEMO_URL is required — there is no default, because a silent one would test the wrong demo.');
if (!relayUrl) throw new Error('RELAY_URL is required — there is no default, because a silent one would answer the wrong relay.');
const withExpiry = process.env.DEMO_E2E_EXPIRY === '1';
const shots = process.env.DEMO_E2E_SCREENSHOT_DIR || mkdtempSync(path.join(tmpdir(), 'demo-outcomes-'));
mkdirSync(shots, { recursive: true });

/** How quickly the page must reflect the relay's answer once the callback lands. */
const PROMPT_MS = 5_000;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => {
  await browser?.close();
  console.log(`[relay-outcomes-browser] screenshots: ${shots}`);
});

type Opened = { context: BrowserContext; page: Page; requestId: Promise<string>; pageErrors: string[] };

/**
 * A fresh page with its own X-Forwarded-For entry, so the relay's per-caller
 * request cap counts this run separately from anything else on the machine.
 */
async function open(query: string): Promise<Opened> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': `198.19.252.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  const requestId = new Promise<string>((resolve, reject) => {
    page.on('request', request => {
      if (request.method() !== 'POST' || !request.url().endsWith('/api/v1/proof/request')) return;
      if (!request.url().startsWith(new URL('/api/v1/proof/request', relayUrl).toString())) {
        reject(new Error(`The page sent its request to ${request.url()}, not to RELAY_URL ${relayUrl}.`));
        return;
      }
      const id = (request.postDataJSON() as { requestId?: unknown }).requestId;
      if (typeof id === 'string' && id) resolve(id); else reject(new Error('The proof request carried no requestId.'));
    });
  });
  await page.goto(new URL(query, demoUrl).toString());
  return { context, page, requestId, pageErrors };
}

/** What the ZKProofport app sends when it finishes, one way or another. */
async function answerAsThePhone(requestId: string, body: Record<string, unknown>) {
  const res = await fetch(new URL('/api/v1/proof/callback', relayUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, circuit: 'coinbase_attestation', ...body }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return Date.now();
}

/** Starts a request on the Markets tab and waits until the page is waiting for the phone. */
async function startOnMarkets(): Promise<Opened & { id: string }> {
  const opened = await open('/?tab=kyc');
  const panel = opened.page.locator('#demo-panel-kyc .proof-panel');
  await panel.locator('button.proof-primary').click();
  await panel.and(opened.page.locator('[data-phase="waiting"]')).waitFor({ timeout: 30_000 });
  return { ...opened, id: await opened.requestId };
}

describe(`the demo shows how a relay request ended (demo ${demoUrl}, relay ${relayUrl})`, () => {
  it('Markets: a decline in the app shows the neutral declined ending and offers Try again', async () => {
    const { context, page, id, pageErrors } = await startOnMarkets();
    try {
      const sent = await answerAsThePhone(id, { status: 'cancelled', error: 'User cancelled the request' });
      const panel = page.locator('#demo-panel-kyc .proof-panel[data-phase="declined"]');
      await panel.waitFor({ timeout: PROMPT_MS });
      const took = Date.now() - sent;
      await page.screenshot({ path: path.join(shots, 'markets-declined.png'), fullPage: false });
      expect(await panel.locator('.proof-notice').textContent()).toBe(DECLINED_MESSAGE);
      expect(await panel.locator('.proof-error').count()).toBe(0);
      expect(await panel.locator('[role="status"]').first().textContent()).toBe('Request declined');
      expect(await panel.locator('button.proof-primary').textContent()).toContain('Try again');
      expect(await page.locator('#demo-panel-kyc .demo-receipt').count()).toBe(0);
      expect(pageErrors).toEqual([]);
      console.log(`[relay-outcomes-browser] declined shown ${took} ms after the callback`);
    } finally { await context.close(); }
  }, 60_000);

  it('Markets: an app error shows its message and error code', async () => {
    const { context, page, id, pageErrors } = await startOnMarkets();
    try {
      const sent = await answerAsThePhone(id, { status: 'error', errorCode: 'E2005', error: 'No attestation found for this wallet' });
      const panel = page.locator('#demo-panel-kyc .proof-panel[data-phase="error"]');
      await panel.waitFor({ timeout: PROMPT_MS });
      const took = Date.now() - sent;
      await page.screenshot({ path: path.join(shots, 'markets-error.png'), fullPage: false });
      const error = panel.locator('.proof-error');
      expect(await error.getAttribute('role')).toBe('alert');
      expect(await error.textContent()).toContain('No attestation found for this wallet');
      expect(await error.locator('.proof-error-code').textContent()).toBe('Error code E2005');
      expect(pageErrors).toEqual([]);
      console.log(`[relay-outcomes-browser] error shown ${took} ms after the callback`);
    } finally { await context.close(); }
  }, 60_000);

  it('All demos: a decline closes the waiting state in the KYC card’s window', async () => {
    const { context, page, requestId, pageErrors } = await open('/?tab=all');
    try {
      await page.locator('#demo-kyc button', { hasText: 'Request Proof' }).click();
      await page.getByText('Waiting for proof...').waitFor({ timeout: 30_000 });
      const sent = await answerAsThePhone(await requestId, { status: 'cancelled' });
      const ending = page.locator('[data-ending="declined"]');
      await ending.waitFor({ timeout: PROMPT_MS });
      const took = Date.now() - sent;
      await ending.screenshot({ path: path.join(shots, 'all-demos-declined.png'), animations: 'disabled' });
      expect(await ending.textContent()).toContain('Request Declined');
      expect(await ending.textContent()).toContain(DECLINED_MESSAGE);
      expect(await page.getByText('Waiting for proof...').count()).toBe(0);
      expect(pageErrors).toEqual([]);
      console.log(`[relay-outcomes-browser] all-demos declined shown ${took} ms after the callback`);
    } finally { await context.close(); }
  }, 60_000);

  it('All demos: an app error shows the message and the code', async () => {
    const { context, page, requestId, pageErrors } = await open('/?tab=all');
    try {
      await page.locator('#demo-kyc button', { hasText: 'Request Proof' }).click();
      await page.getByText('Waiting for proof...').waitFor({ timeout: 30_000 });
      await answerAsThePhone(await requestId, { status: 'error', errorCode: 'E2005', error: '<b>증명 실패</b> 🙏' });
      const ending = page.locator('[data-ending="error"]');
      await ending.waitFor({ timeout: PROMPT_MS });
      await ending.screenshot({ path: path.join(shots, 'all-demos-error.png'), animations: 'disabled' });
      expect(await ending.textContent()).toContain('<b>증명 실패</b> 🙏');
      expect(await ending.locator('b').count()).toBe(0);
      expect(await ending.textContent()).toContain('Error code E2005');
      expect(pageErrors).toEqual([]);
    } finally { await context.close(); }
  }, 60_000);

  it.runIf(withExpiry)('Markets: an unanswered request ends with the relay’s expired answer, before the demo’s own timer', async () => {
    const { context, page, pageErrors } = await startOnMarkets();
    try {
      const panel = page.locator('#demo-panel-kyc .proof-panel[data-phase="expired"]');
      await panel.waitFor({ timeout: 300_000 });
      await page.screenshot({ path: path.join(shots, 'markets-expired.png'), fullPage: false });
      // The relay's message, not the demo's no-answer fallback.
      expect(await panel.locator('.proof-notice').textContent()).toBe(EXPIRED_MESSAGE);
      expect(pageErrors).toEqual([]);
    } finally { await context.close(); }
  }, 330_000);
});
