# Gotgan — a KYC-gated vault on GIWA

Gotgan is the institutional KRW vault experience within the GIWA demo tab.

Open `http://localhost:3300/?tab=giwa` after `npm run dev`.

- Operational wallet: `0x3fee628efe472ff6a6dce527523b131f2d973afb`
- dKRW (6 decimals): `0x417573024528f3c9daD782eF5316E992F3029e81`
- Vault: `0x18F72bF293E96117AF2641F304B5F1f274864EC8`
- Verifier: `0xeb9eb5452790cfe549ff83ceb3dbe1c432231492`
- GIWA Sepolia chain ID: `91342`

## Recording sequence

1. Select the operational wallet in an injected Ethereum wallet (e.g. MetaMask), then connect. The UI requests GIWA Sepolia if necessary. It refuses other accounts.
2. Keep the default 10,000 dKRW deposit or enter another amount.
3. Click **Deposit dKRW** before generating a proof. The page calls the deployed Vault's `deposit` using `eth_call`. It only shows **Deposit blocked** when the contract returns `ProofRequired()`. This is a real contract preflight, not a mined failed transaction; funds do not move and no gas is spent.
4. Click **Generate eligibility proof**. Scan the QR code using ZKProofport and the separate, attested KYC wallet.
5. The page checks the relay result against the fixed circuit, chain, verifier, test issuer root and exact `depositScope(operationalWallet, amount)`. It then calls the Vault's `verifyEligibility` before displaying **Verified**.
6. If required, click **Approve dKRW** and confirm in the operational wallet. Approval is limited to the selected amount.
7. Click **Deposit dKRW** again and confirm in the wallet. **Deposit confirmed** appears only after a successful receipt. Balances refresh and the explorer link opens the actual transaction.
8. Withdraw via the separate **Withdraw** tab when needed. Withdrawals return the caller's own deposits to the operational wallet without a new proof.

Changing amount, switching between deposit/withdraw, changing account/network or cancelling a proof invalidates the current UI proof. The Vault's scope includes its current nonce, so every successful deposit requires a fresh proof for the next deposit. Refreshing the page discards the in-memory proof and last transaction receipt; contract balances remain available.

The Vault uses the configured `NEXT_PUBLIC_RELAY_URL` (default: `https://relay.zkproofport.app`) through a narrowly scoped same-origin `/api/giwa-relay` adapter. This supports localhost without changing production relay CORS permissions. The SDK creates the request and polls the result over HTTP every two seconds. Mobile deep links and callbacks retain the public relay URL. The phone must be able to reach that relay. Browser reads use the public GIWA Sepolia RPC. The GIWA circuit does not require an SDK wallet signature for relay requests. Only the connected operational wallet signs Vault and token transactions. Fee bumps for the same action use the replacement receipt and transaction hash; cancellations and different replacement actions are not reported as successful deposits or withdrawals.

This is a testnet custody demo, not ERC-4626, a yield product or a KRW-backed instrument. The GIWA circuit uses the test attestation profile, not production Upbit KYC or live revocation/expiry verification. Public inputs and the operational wallet's transactions remain public; the KYC address itself is not submitted to the Vault. No onchain transactions are sent automatically on page load or on receipt of a mobile proof.

## Gotgan identity

The Gotgan tab, browser title, logo, vault labels, recipient name and mobile
proof request use the same brand. Brand assets live in `public/brand/gotgan-*`.
The mobile request's public icon URL becomes available when these assets are
deployed to `demo.zkproofport.app`; localhost does not publish assets to that host.
