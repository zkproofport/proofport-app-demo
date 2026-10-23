/**
 * Real HTTP boundary test: SDK -> running relay -> mobile deep-link payload,
 * followed by polling. The demo's browser code calls the relay this way, with
 * no server of its own in between, so this is the same path.
 *
 * Supply the relay under test explicitly:
 *   RELAY_URL=https://stg-relay.zkproofport.app npm run test:e2e
 *
 * It creates a real pending request, never posts a fabricated proof callback,
 * and therefore does not claim phone generation or onchain proof success.
 */
import { describe, expect, it } from 'vitest';
import { CIRCUIT_IDS, ProofportSDK } from '@zkproofport-app/sdk';
import { AbiCoder, Contract, hexlify, JsonRpcProvider, keccak256, randomBytes, TypedDataEncoder, Wallet } from 'ethers';
import { buildGiwaDepositAction, GIWA_RPC, TOKEN_ADDRESS, VAULT_ABI, VAULT_ADDRESS, vaultErrorName } from '../lib/giwa-vault';

const relayUrl = process.env.RELAY_URL;
if (!relayUrl) throw new Error('RELAY_URL is required: the relay the request is created on.');

describe('a browser on any site may call the relay', () => {
  it.each(['https://demo.zkproofport.app', 'https://dojangscan.com', 'http://localhost:3000'])('answers %s on every endpoint the SDK uses', async (origin) => {
    for (const [path, method, headers] of [
      ['/api/v1/challenge', 'GET', undefined],
      ['/api/v1/proof/request', 'POST', 'content-type'],
      ['/api/v1/proof/00000000-0000-4000-8000-000000000000', 'GET', undefined],
    ] as const) {
      const preflight = await fetch(new URL(path, relayUrl), {
        method: 'OPTIONS', signal: AbortSignal.timeout(15000),
        headers: { Origin: origin, 'Access-Control-Request-Method': method, ...(headers ? { 'Access-Control-Request-Headers': headers } : {}) },
      });
      expect(preflight.headers.get('access-control-allow-origin'), `${method} ${path}`).toBe('*');
    }
  }, 60000);
});

describe('Gotgan deposit request crosses the real relay', () => {
  it('preserves scope and the complete EIP-712 action for the phone and polls the same pending request', async () => {
    const wallet = Wallet.createRandom();
    const scope = `giwa-vault:v1:${keccak256(randomBytes(32)).slice(2)}`;
    const action = buildGiwaDepositAction(wallet.address, BigInt(1000000), BigInt(0));
    const sdk = new ProofportSDK({ relayUrl });
    sdk.setSigner(wallet);
    try {
      const pending = await sdk.createRelayRequest(CIRCUIT_IDS.GIWA_ATTESTATION, { scope, action }, {
        dappName: 'Gotgan', message: `Verify a Gotgan deposit ${hexlify(randomBytes(8))}`,
      });
      expect(pending.requestId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(pending.status).toBe('pending');
      const encoded = new URL(pending.deepLink).searchParams.get('data');
      expect(encoded, 'the phone needs the complete relay payload').toBeTruthy();
      const payload = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8'));
      expect(payload.circuitId).toBe('giwa_attestation');
      expect(payload.inputs.scope).toBe(scope);
      expect(payload.inputs.action).toEqual({
        domain: { name: 'Gotgan', version: '2', chainId: 91342, verifyingContract: VAULT_ADDRESS },
        primaryType: 'Deposit',
        types: { Deposit: [
          { name: 'account', type: 'address' }, { name: 'asset', type: 'address' },
          { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
        ] },
        message: { account: wallet.address, asset: TOKEN_ADDRESS, amount: '1000000', nonce: '0' },
      });

      const polled = await sdk.pollResult(pending.requestId);
      expect(polled.requestId).toBe(pending.requestId);
      expect(polled.status).toBe('pending');
      expect(polled.deepLink).toBe(pending.deepLink);
      expect(polled.proof).toBeUndefined();

      // The request lives on the relay that was named, nowhere else.
      const direct = await fetch(new URL(`/api/v1/proof/${pending.requestId}`, relayUrl), {
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      expect(direct.status).toBe(200);
      const stored = await direct.json();
      expect(stored.requestId).toBe(pending.requestId);
      expect(stored.status).toBe('pending');
      expect(stored.deepLink).toBe(pending.deepLink);
    } finally {
      sdk.disconnect();
    }
  }, 60000);
});

describe('the deployed GIWA vault agrees with the SDK deposit action', () => {
  it('matches nonce, scope, domain and action at one block and rejects an unproved deposit', async () => {
    const account = Wallet.createRandom().address;
    const provider = new JsonRpcProvider(GIWA_RPC, 91342, { staticNetwork: true, cacheTimeout: -1 });
    const contract = new Contract(VAULT_ADDRESS, [
      ...VAULT_ABI,
      'function asset() view returns (address)',
      'function VERIFIER() view returns (address)',
    ], provider);
    try {
      expect(Number(await provider.send('eth_chainId', []))).toBe(91342);
      const blockTag = await provider.getBlockNumber();
      const amount = BigInt(1000000);
      const [code, nonce, scope, domainHash, actionHash, asset, verifier] = await Promise.all([
        provider.getCode(VAULT_ADDRESS, blockTag),
        contract.nonces(account, { blockTag }),
        contract.depositScope(account, amount, { blockTag }),
        contract.domainSeparator({ blockTag }),
        contract.depositActionHash(account, amount, { blockTag }),
        contract.asset({ blockTag }), contract.VERIFIER({ blockTag }),
      ]);
      expect(code).not.toBe('0x');
      expect(asset.toLowerCase()).toBe(TOKEN_ADDRESS.toLowerCase());
      // The deployed vault's immutable VERIFIER predates the beta.19 verifier; it is not the demo's proof allowlist.
      expect(verifier.toLowerCase()).toBe('0x5da234546874304f8c51bbeed00fc632938211c1');
      const action = buildGiwaDepositAction(account, amount, nonce);
      expect(TypedDataEncoder.hashDomain(action.domain)).toBe(domainHash);
      expect(TypedDataEncoder.hashStruct(action.primaryType, action.types, action.message)).toBe(actionHash);
      const encoded = AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'address', 'address', 'address', 'uint256', 'uint256'],
        [91342, VAULT_ADDRESS, TOKEN_ADDRESS, account, amount, nonce],
      );
      expect(scope).toBe(`giwa-vault:v1:${keccak256(encoded).slice(2)}`);

      // eth_call only: no wallet key, transfer, approval or transaction broadcast.
      let rejection: unknown;
      try { await contract.deposit.staticCall(amount, '0x', [], { from: account, blockTag }); }
      catch (error) { rejection = error; }
      expect(rejection, 'an unproved deposit must revert').toBeDefined();
      expect(vaultErrorName(rejection), 'a network failure is not proof-policy enforcement').toBe('ProofRequired');
    } finally {
      provider.destroy();
    }
  }, 60000);
});
