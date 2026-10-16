/**
 * Ask the relay for a proof request for every demo, and say which ones it took.
 *
 * This is the half of the flow that needs no wallet and no phone: the demo
 * builds its inputs, the SDK signs a challenge, and the relay either accepts
 * the circuit and its inputs or refuses them. Checking it by hand meant
 * clicking through eight tabs, so in practice one was clicked and the rest
 * assumed — which is how a new tab came to render another demo's screen.
 *
 * It talks to a running relay over HTTP, so it is kept out of `npm test` and run
 * on its own:
 *
 *   RELAY_URL=http://localhost:4001 npm run test:e2e
 *
 * It sends one request per demo (eight), and the relay takes ten per minute
 * from one address (proofport-relay/src/app.ts), so a second run inside the
 * same minute is answered "Too many requests". Wait a minute between runs.
 */
import { describe, it, expect } from 'vitest';
import { ProofportSDK } from '@zkproofport-app/sdk';
import { ethers } from 'ethers';
import { DEMOS } from '../lib/demo-catalog';
import { DEFAULT_OPTIONS, buildDemoInputs } from '../lib/demo-policy';
import { cardScope } from '../lib/demo-scopes';

const relayUrl = process.env.RELAY_URL;
if (!relayUrl) throw new Error('RELAY_URL is required — there is no default, because a silent one would check the wrong relay.');

describe(`the relay takes a request from every demo`, () => {
  for (const demo of DEMOS) {
    it(`${demo.tab} — ${demo.circuit}`, async () => {
      const scope = cardScope(demo.id);
      const sdk = new ProofportSDK({ relayUrl });
      // Ephemeral, like the browser's: the relay only uses it to stop a replayed request.
      sdk.setSigner(ethers.Wallet.createRandom());
      try {
        const inputs = buildDemoInputs(demo, DEFAULT_OPTIONS, scope);
        const pending = await sdk.createRelayRequest(demo.circuit, inputs, {
          dappName: demo.brand,
          dappIcon: 'https://demo.zkproofport.app/icon.png',
          message: demo.actionDescription,
        });
        expect(pending.requestId, 'the relay answered without a request id').toBeTruthy();
        expect(pending.deepLink, 'the relay answered without a deep link').toBeTruthy();
        // The link is what the phone opens, so it must name this demo's circuit
        // and no other — the failure that renders one demo inside another. The
        // name is inside the link's base64 payload, not a query parameter.
        const payload = new URL(pending.deepLink.replace('zkproofport://', 'https://deeplink/')).searchParams.get('data');
        expect(payload, 'the deep link carries no payload').toBeTruthy();
        const carried = JSON.parse(Buffer.from(payload!, 'base64').toString('utf8'));
        expect(carried.circuitId).toBe(demo.circuit);
        // The demo's own scope, inside the inputs the phone proves and on the
        // envelope the relay counts per scope.
        expect(carried.inputs.scope).toBe(scope);
        expect(carried.scope).toBe(scope);
      } finally {
        sdk.disconnect();
      }
    }, 30000);
  }
});
