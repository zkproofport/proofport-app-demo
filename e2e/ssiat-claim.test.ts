/**
 * A real Ssiat claim, end to end: the deployed demo in a headless browser, a
 * real recipient wallet on GIWA Sepolia, a real phone proof, a real claim
 * transaction, and the chain read back afterwards.
 *
 * The browser's wallet is injected by this test (window.ethereum backed by an
 * ethers Wallet in Node), so nothing touches the host screen or cursor. The
 * phone is ZKProofport: with SSIAT_E2E_SIMULATOR set to a booted simulator's
 * UDID the test opens the request's deep link there (`xcrun simctl openurl`);
 * otherwise it prints the link for a phone. The person or session driving the
 * app approves the request and signs with the Playground faucet wallet
 * (for the simulator: proofport-app/scripts/dev-wallet.js --from-simulator).
 *
 *   SSIAT_E2E_RECIPIENT_KEY=0x...   recipient wallet; needs a little GIWA Sepolia ETH
 *   SSIAT_E2E_EXPECT=claimed|already-claimed
 *   DEMO_URL=https://stg-demo.zkproofport.app
 *   SSIAT_E2E_SIMULATOR=<udid>      optional
 *   npm run test:e2e -- e2e/ssiat-claim.test.ts
 *
 * One claim per faucet wallet per drop: the first run with a faucet wallet
 * expects `claimed`, every later run with it `already-claimed`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { chromium, type Browser } from 'playwright-core';
import { Contract, JsonRpcProvider, Wallet, toBeHex } from 'ethers';
import { GIWA_RPC } from '../lib/giwa-vault';
import { GIWA_CHAIN_ID } from '../lib/giwa-membership';
import { SSIAT_DROP_ADDRESS } from '../lib/ssiat-drop';

const demoUrl = process.env.DEMO_URL;
const recipientKey = process.env.SSIAT_E2E_RECIPIENT_KEY;
const expectOutcome = process.env.SSIAT_E2E_EXPECT;
const simulator = process.env.SSIAT_E2E_SIMULATOR;
if (!demoUrl) throw new Error('DEMO_URL is required — there is no default, because a silent one would test the wrong demo.');
if (!recipientKey) throw new Error('SSIAT_E2E_RECIPIENT_KEY is required: the recipient wallet that sends the claim.');
const OUTCOMES = ['claimed', 'already-claimed'] as const;
if (!OUTCOMES.includes(expectOutcome as typeof OUTCOMES[number])) {
  throw new Error(`SSIAT_E2E_EXPECT '${expectOutcome}' is not one of: ${OUTCOMES.join(', ')}.`);
}

const PROOF_WAIT_MS = 300_000;
const shots = mkdtempSync(path.join(tmpdir(), 'ssiat-claim-'));
const rpc = new JsonRpcProvider(GIWA_RPC, GIWA_CHAIN_ID, { staticNetwork: true });
const recipient = new Wallet(recipientKey, rpc);
const drop = new Contract(SSIAT_DROP_ADDRESS, ['function token() view returns (address)', 'function CLAIM_AMOUNT() view returns (uint256)', 'function totalClaims() view returns (uint256)'], rpc);

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => {
  await browser?.close();
  console.log(`[ssiat-claim] screenshots: ${shots}`);
});

/** Answers the page's EIP-1193 calls with the recipient wallet; reads go to the GIWA RPC. */
async function walletCall(method: string, params: unknown[] = []): Promise<unknown> {
  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts': return [recipient.address];
    case 'eth_chainId': return toBeHex(GIWA_CHAIN_ID);
    case 'wallet_switchEthereumChain': return null;
    case 'eth_sendTransaction': {
      const [tx] = params as [{ to: string; data?: string; value?: string; chainId?: string }];
      const sent = await recipient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ?? 0, chainId: GIWA_CHAIN_ID });
      console.log(`[ssiat-claim] claim sent ${sent.hash}`);
      return sent.hash;
    }
    default: return rpc.send(method, params);
  }
}

describe(`a real Ssiat claim (demo ${demoUrl}, drop ${SSIAT_DROP_ADDRESS})`, () => {
  it(`ends ${expectOutcome}`, async () => {
    const token = new Contract(await drop.token(), ['function balanceOf(address) view returns (uint256)'], rpc);
    const amount: bigint = await drop.CLAIM_AMOUNT();
    const balanceBefore: bigint = await token.balanceOf(recipient.address);
    const claimsBefore: bigint = await drop.totalClaims();

    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.exposeFunction('__ssiatWallet', (method: string, params: unknown[]) =>
      walletCall(method, params).catch(e => ({ __error: e instanceof Error ? e.message : String(e) })));
    await page.addInitScript(() => {
      const call = (window as unknown as { __ssiatWallet: (m: string, p: unknown[]) => Promise<unknown> }).__ssiatWallet;
      (window as unknown as { ethereum: unknown }).ethereum = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          const result = await call(method, params ?? []);
          if (result && typeof result === 'object' && '__error' in result) throw new Error(String((result as { __error: unknown }).__error));
          return result;
        },
        on: () => {}, removeListener: () => {},
      };
    });

    try {
      await page.goto(new URL('/?tab=ssiat', demoUrl).toString());
      await page.getByRole('button', { name: /Connect recipient wallet/ }).click();
      await page.getByRole('button', { name: /Prove faucet participation/ }).click();
      const link = page.locator('a.sd-open-app');
      await link.waitFor({ timeout: 30_000 });
      const deepLink = await link.getAttribute('href');
      expect(deepLink).toMatch(/^zkproofport:\/\//);
      await page.screenshot({ path: path.join(shots, 'waiting.png') });
      if (simulator) {
        execFileSync('xcrun', ['simctl', 'openurl', simulator, deepLink!]);
        console.log(`[ssiat-claim] opened the request in simulator ${simulator}; approve it in the app`);
      } else {
        console.log(`[ssiat-claim] open on the phone: ${deepLink}`);
      }

      const ready = page.getByRole('button', { name: /Claim seeds/ });
      const already = page.getByRole('heading', { name: 'Already claimed' });
      await ready.or(already).first().waitFor({ timeout: PROOF_WAIT_MS });
      await page.screenshot({ path: path.join(shots, 'after-proof.png') });

      if (expectOutcome === 'already-claimed') {
        expect(await already.isVisible()).toBe(true);
        expect(await drop.totalClaims()).toBe(claimsBefore);
        expect(await token.balanceOf(recipient.address)).toBe(balanceBefore);
      } else {
        expect(await ready.isVisible()).toBe(true);
        await ready.click();
        await page.getByRole('heading', { name: 'Seeds claimed' }).waitFor({ timeout: 120_000 });
        // The page's own figures must show the claim, not a read from before it.
        const claimsShown = page.locator('div', { has: page.locator('dt', { hasText: 'Claims so far' }) }).locator('dd');
        await expect.poll(() => claimsShown.textContent(), { timeout: 30_000 }).toBe((claimsBefore + BigInt(1)).toLocaleString('en-US'));
        await page.screenshot({ path: path.join(shots, 'claimed.png') });
        const txUrl = await page.getByRole('link', { name: /View transaction/ }).getAttribute('href');
        console.log(`[ssiat-claim] ${txUrl}`);
        expect(await token.balanceOf(recipient.address)).toBe(balanceBefore + amount);
        expect(await drop.totalClaims()).toBe(claimsBefore + BigInt(1));
      }
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }, PROOF_WAIT_MS + 180_000);
});
