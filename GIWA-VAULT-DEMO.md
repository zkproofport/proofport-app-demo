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

1. Select the operational wallet in an injected Ethereum wallet (e.g. MetaMask), then connect. The UI requests GIWA Sepolia if necessary. It refuses other accounts.
2. Keep the default 10,000 dKRW deposit or enter another amount.
3. Click **Deposit dKRW** before generating a proof. The page calls the deployed Vault's `deposit` using `eth_call`. It only shows **Deposit blocked** when the contract returns `ProofRequired()`. This is a real contract preflight, not a mined failed transaction; funds do not move and no gas is spent.
4. Click **Generate eligibility proof**. Scan the QR code using ZKProofport and an attested KYC wallet. Review and sign the Gotgan v2 `Deposit` action: operational account, dKRW asset, amount in token units, and current nonce. The KYC wallet may be different from the operational wallet.
5. The page checks the relay result against the fixed circuit, chain, verifier, test issuer root, all 192 public inputs, exact EIP-712 domain/action hashes and exact `depositScope(operationalWallet, amount)`. It then calls the Vault's `verifyEligibility` before displaying **Verified**.
6. If required, click **Approve dKRW** and confirm in the operational wallet. Approval is limited to the selected amount.
7. Click **Deposit dKRW** again and confirm in the wallet. **Deposit confirmed** appears only after a successful receipt. Balances refresh and the explorer link opens the actual transaction.
8. Withdraw via the separate **Withdraw** tab when needed. Withdrawals return the caller's own deposits to the operational wallet without a new proof.

Changing amount, switching between deposit/withdraw, changing account/network or cancelling a proof invalidates the current UI proof. The Vault's scope includes its current nonce, so every successful deposit requires a fresh proof for the next deposit. Refreshing the page discards the in-memory proof and last transaction receipt; contract balances remain available.

The demo requires server-side `RELAY_URL`, supplied by the Docker or Cloud Run configuration, and uses a narrowly scoped same-origin `/api/giwa-relay` adapter. Staging uses the staging relay. Missing configuration fails explicitly; it never silently chooses production. An ephemeral SDK signer authenticates the relay challenge. That signer does not control funds and is separate from the mobile KYC action signer and operational transaction signer. The SDK creates the request with `{ scope, action }` and polls every two seconds. Mobile deep links and callbacks retain the relay's public URL. The phone must be able to reach that relay. Browser reads use the public GIWA Sepolia RPC.

The page reads scope, nonce, domain and action hashes at the same block, constructs the typed action using the existing deposit amount, and cross-checks it against the deployed Vault before showing a QR code. A changed account, amount or consumed nonce requires a fresh proof. Fee bumps for the same action use the replacement receipt; cancellations and different replacement actions are not reported as successful transactions.

This is a testnet custody demo, not ERC-4626, a yield product or a KRW-backed instrument. The GIWA circuit uses the test attestation profile, not production Upbit KYC or live revocation/expiry verification. Public inputs and the operational wallet's transactions remain public; the KYC address itself is not submitted to the Vault. No onchain transactions are sent automatically on page load or on receipt of a mobile proof.

## Gotgan identity

The Gotgan tab, browser title, logo, vault labels, recipient name and mobile
proof request use the same brand. Brand assets live in `public/brand/gotgan-*`.
The mobile request uses the current demo origin for its icon, so staging requests retain staging branding URLs.
