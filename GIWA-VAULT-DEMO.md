# Gotgan — a KYC-gated vault on GIWA

Gotgan is the institutional KRW vault experience within the GIWA demo tab.

Start the parent workspace with `./scripts/dev.sh`, then open `http://localhost:3300/?tab=giwa`. The existing Gotgan screen is retained; SDK 0.3.3 supplies the action-capable relay flow.

- Operational wallet A: any connected Ethereum account on GIWA Sepolia
- dKRW (6 decimals): `0x417573024528f3c9daD782eF5316E992F3029e81`
- Vault v2: `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c`
- Verifier: `0x5Da234546874304F8c51BBEed00fC632938211c1`
- GIWA Sepolia chain ID: `91342`

Vault v2 was deployed in transaction `0xcac293988fbc00d30082db58beec4c1fdb396c1b5811c769364bd1d359cca0da` on 2026-09-23 KST. The old v1 vault `0x18F72bF293E96117AF2641F304B5F1f274864EC8` remains unchanged: its owner can withdraw existing demo deposits by calling its `withdraw(uint256)` through the GIWA explorer or contract tooling. The new screen uses v2; it does not migrate balances or allowances.

## Recording sequence

1. Open the GIWA tab and connect the operational wallet A you want to deposit from. Any Ethereum account is supported; there is no address allowlist. The UI requests GIWA Sepolia. The header and position show this account, while disconnected personal balances remain blank.
2. Keep the default 10,000 dKRW deposit or enter another amount. Click **Deposit dKRW** before generating a proof to demonstrate rejection. The page calls the Vault's `deposit` using `eth_call` and shows **Deposit blocked** only when the contract returns `ProofRequired()`. No transaction is broadcast and no gas is spent.
3. Click **Generate eligibility proof**. Desktop shows a centered QR code up to 360 px wide, generated at 1080 px for sharp rendering. Mobile shows **Open ZKProofport**. In the app, use the GIWA-attested KYC wallet B to sign the Gotgan v2 `Deposit` action for connected account A, the dKRW asset, amount and current nonce. B does not send the token transaction.
4. The page checks the relay result against the fixed circuit, chain, verifier, test issuer root, all 192 public inputs, exact EIP-712 domain/action hashes and `depositScope(A, amount)`. It automatically calls the Vault's `verifyEligibility` before displaying **Verified**. There are no separate verification buttons.
5. If required, click **Approve dKRW** and confirm in A. Approval is limited to the selected amount.
6. Click **Deposit dKRW** and confirm in A. **Deposit confirmed** appears only after a successful receipt. Balances refresh and the explorer link opens the actual transaction. Each write rechecks the connected account, chain, proof-bound account/amount and current nonce.
7. Withdraw via the separate **Withdraw** tab. Withdrawals return the caller's own deposits to that same wallet without a new proof.

Changing amount, switching between deposit/withdraw or cancelling a proof invalidates the current UI proof. Changing the browser account/network clears the connection, pending request and proof; reconnect and generate a fresh proof for the selected account. Late relay results cannot restore an invalidated proof. Every successful deposit consumes its nonce and requires a fresh proof for the next deposit. Refreshing the page discards the in-memory proof and receipt; contract balances remain available after reconnecting.

The demo requires server-side `RELAY_URL`, supplied by the Docker or Cloud Run configuration, and uses a narrowly scoped same-origin `/api/giwa-relay` adapter. Staging uses the staging relay. Missing configuration fails explicitly; it never silently chooses production. An ephemeral SDK signer authenticates the relay challenge. That signer does not control funds and is separate from the mobile KYC action signer and operational transaction signer. The SDK creates the request with `{ scope, action }` and polls every two seconds. Mobile deep links and callbacks retain the relay's public URL. The phone must be able to reach that relay. Browser reads use the public GIWA Sepolia RPC.

The page reads scope, nonce, domain and action hashes at the same block, constructs the typed action using the existing deposit amount, and cross-checks it against the deployed Vault before showing a QR code. A changed account, amount or consumed nonce requires a fresh proof. Fee bumps for the same action use the replacement receipt; cancellations and different replacement actions are not reported as successful transactions.

This is a testnet custody demo, not ERC-4626, a yield product or a KRW-backed instrument. The GIWA circuit uses the test attestation profile, not production Upbit KYC or live revocation/expiry verification. Public inputs and the operational wallet's transactions remain public; the KYC address itself is not submitted to the Vault. No onchain transactions are sent automatically on page load or on receipt of a mobile proof.

## Gotgan identity

The Gotgan tab, browser title, logo, vault labels, recipient name and mobile
proof request use the same brand. Brand assets live in `public/brand/gotgan-*`.
The mobile request uses the current demo origin for its icon, so staging requests retain staging branding URLs.
