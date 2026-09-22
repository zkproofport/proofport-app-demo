# Gotgan — a KYC-gated vault on GIWA

Gotgan is the institutional KRW vault experience within the GIWA demo tab.

Start the parent workspace with `./scripts/dev.sh`, then open `http://localhost:3300/?tab=giwa`. The existing Gotgan screen is retained; SDK 0.3.3 supplies the action-capable relay flow.

- Operational wallet: `0x3fee628efe472ff6a6dce527523b131f2d973afb`
- dKRW (6 decimals): `0x417573024528f3c9daD782eF5316E992F3029e81`
- Vault v2: `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c`
- Verifier: `0x5Da234546874304F8c51BBEed00fC632938211c1`
- GIWA Sepolia chain ID: `91342`

Vault v2 was deployed in transaction `0xcac293988fbc00d30082db58beec4c1fdb396c1b5811c769364bd1d359cca0da` on 2026-09-23 KST. The old v1 vault `0x18F72bF293E96117AF2641F304B5F1f274864EC8` remains unchanged: its owner can withdraw existing demo deposits by calling its `withdraw(uint256)` through the GIWA explorer or contract tooling. The new screen uses v2; it does not migrate balances or allowances.

## Recording sequence

1. Open the GIWA tab and keep the default 10,000 dKRW deposit or enter another amount. The configured operational wallet's balances are read over RPC; a browser wallet is not required.
2. Click **Generate eligibility proof**, available immediately without connecting MetaMask. Desktop shows the SDK QR code; mobile shows **Open ZKProofport** using the SDK deep link. The page reuses the demo's shared device detection. In the app, use the GIWA-attested KYC wallet to review and sign the Gotgan v2 `Deposit` action for the configured operational account, dKRW asset, amount in token units, and current nonce. The KYC wallet and operational wallet have separate roles and may be the same address.
3. The page checks the relay result against the fixed circuit, chain, verifier, test issuer root, all 192 public inputs, exact EIP-712 domain/action hashes and exact `depositScope(operationalWallet, amount)`. It then calls the Vault's `verifyEligibility` before displaying **Verified**.
4. Use **Off-Chain Verify** for the SDK's browser verification or **On-Chain Verify** for the SDK's read-only verifier call. These use the returned proof and distinct SDK methods. Neither needs a browser wallet or sends a transaction.
5. Only to move dKRW, select the configured operational account in an injected Ethereum wallet (e.g. MetaMask) and click **Connect operational wallet**. The UI requests GIWA Sepolia and refuses other transaction signers. Connecting or switching the browser wallet does not discard the mobile proof for the fixed account.
6. If required, click **Approve dKRW** and confirm in the operational wallet. Approval is limited to the selected amount.
7. Click **Deposit dKRW** and confirm in the wallet. **Deposit confirmed** appears only after a successful receipt. Balances refresh and the explorer link opens the actual transaction. Each write rechecks the connected account, chain, proof-bound account/amount and current nonce.
8. Withdraw via the separate **Withdraw** tab when needed. Withdrawals return the caller's own deposits to the operational wallet without a new proof. A connected operational signer is still required.

Changing amount, switching between deposit/withdraw or cancelling a proof invalidates the current UI proof. Changing the browser account/network invalidates transaction authority, while preserving the independent proof for the configured operational account. The Vault's scope includes its current nonce, so every successful deposit requires a fresh proof for the next deposit. Refreshing the page discards the in-memory proof and last transaction receipt; contract balances remain available.

The demo requires server-side `RELAY_URL`, supplied by the Docker or Cloud Run configuration, and uses a narrowly scoped same-origin `/api/giwa-relay` adapter. Staging uses the staging relay. Missing configuration fails explicitly; it never silently chooses production. An ephemeral SDK signer authenticates the relay challenge. That signer does not control funds and is separate from the mobile KYC action signer and operational transaction signer. The SDK creates the request with `{ scope, action }` and polls every two seconds. Mobile deep links and callbacks retain the relay's public URL. The phone must be able to reach that relay. Browser reads use the public GIWA Sepolia RPC.

The page reads scope, nonce, domain and action hashes at the same block, constructs the typed action using the existing deposit amount, and cross-checks it against the deployed Vault before showing a QR code. A changed account, amount or consumed nonce requires a fresh proof. Fee bumps for the same action use the replacement receipt; cancellations and different replacement actions are not reported as successful transactions.

This is a testnet custody demo, not ERC-4626, a yield product or a KRW-backed instrument. The GIWA circuit uses the test attestation profile, not production Upbit KYC or live revocation/expiry verification. Public inputs and the operational wallet's transactions remain public; the KYC address itself is not submitted to the Vault. No onchain transactions are sent automatically on page load or on receipt of a mobile proof.

## Gotgan identity

The Gotgan tab, browser title, logo, vault labels, recipient name and mobile
proof request use the same brand. Brand assets live in `public/brand/gotgan-*`.
The mobile request uses the current demo origin for its icon, so staging requests retain staging branding URLs.
