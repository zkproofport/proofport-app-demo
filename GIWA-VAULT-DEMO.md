# Gotgan — a KYC-gated vault on GIWA

Gotgan is the institutional KRW vault experience within the GIWA demo tab.

Start the parent workspace with `./scripts/dev.sh`, then open `http://localhost:3300/?tab=giwa`. The existing Gotgan screen is retained; SDK 0.3.3 supplies the action-capable relay flow.

- Operational wallet A: any connected Ethereum account on GIWA Sepolia
- dKRW (6 decimals): `0x417573024528f3c9daD782eF5316E992F3029e81`
- Vault v2: `0x41d707cD61847bB6939F3F1182eC96EFE6AaA983`
- Verifiers (`giwa_attestation` v2), one per signer package: standard `0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE`, android `0x428074597be3D784535e40F9b1cDfe048AF57F03`, android_factory `0x465FAB030D82241BD95268704537A782B8109807`
- GIWA Sepolia chain ID: `91342`

The current vault was deployed in transaction `0xdc372e8177bf452c0be391a7e4a3a8e0ded5b8e42419fe32390f181419b9301a` (block 42423538) on 2026-11-27 KST with `scripts/deploy-demo-contract.sh giwa-vault --broadcast`, against the three GIWA v2 verifiers and the 133-input layout (`attested_at` at 132); `contracts/README.md` has the RPC readback and the deploy procedure. Every proof-taking call names the package that made the proof (`signerVariant`: 0 standard, 1 android, 2 android_factory), which the page takes from the relay result. The vaults deployed on 2026-11-21 at `0xAbc9a559967d6670257189B1dAd9d397f79a849e` (transaction `0xf6e1944753e7cf23b9a271456224126d0c7d458153bacc8c42b1b84c64f13b73`, bb 6.0.0 verifier `0xA272056866453F0182426A29B9Ca6382d6C6a060`, 132-input layout), on 2026-10-23 at `0x79e327731172EA4b522dD1c7Df6e61d1D3fB2620` (transaction `0xadb6093ebecd473bd9154f01e4c6e20cded2aacf045abe4ff1e6fad9a30df3c3`, beta.19 verifier `0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3`) and on 2026-09-23 at `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c` (transaction `0xcac293988fbc00d30082db58beec4c1fdb396c1b5811c769364bd1d359cca0da`, old-toolchain verifier `0x5Da234546874304F8c51BBEed00fC632938211c1`) are retired: their verifiers are compiled in and refuse current proofs. Deposits in them stay withdrawable through each one's own `withdraw(uint256)`. The old v1 vault `0x18F72bF293E96117AF2641F304B5F1f274864EC8` remains unchanged: its owner can withdraw existing demo deposits by calling its `withdraw(uint256)` through the GIWA explorer or contract tooling. The new screen uses v2; it does not migrate balances or allowances.

## Recording sequence

1. Open the GIWA tab and connect the operational wallet A you want to deposit from. Any Ethereum account is supported; there is no address allowlist. The UI requests GIWA Sepolia. The header and position show this account, while disconnected personal balances remain blank.
2. Keep the default 10,000 dKRW deposit or enter another amount. Click **Deposit dKRW** before generating a proof to demonstrate rejection. The page calls the Vault's `deposit` using `eth_call` and shows **Deposit blocked** only when the contract returns `ProofRequired()`. No transaction is broadcast and no gas is spent.
3. Click **Generate eligibility proof**. Desktop shows a centered QR code up to 360 px wide, generated at 1080 px for sharp rendering. Mobile shows **Open ZKProofport**. In the app, use the GIWA-attested KYC wallet B to sign the Gotgan v2 `Deposit` action for connected account A, the dKRW asset, amount and current nonce. B does not send the token transaction.
4. The page checks the relay result against the fixed circuit, chain, verifier, test issuer root, all 133 public inputs (the OPRF key hash, domain and scope included), exact EIP-712 domain/action hashes and `depositScope(A, amount)`. It automatically calls the Vault's `verifyEligibility`, naming the proof's signer package, before displaying **Verified**. There are no separate verification buttons.
5. If required, click **Approve dKRW** and confirm in A. Approval is limited to the selected amount.
6. Click **Deposit dKRW** and confirm in A. **Deposit confirmed** appears only after a successful receipt. Balances refresh and the explorer link opens the actual transaction. Each write rechecks the connected account, chain, proof-bound account/amount and current nonce.
7. Withdraw via the separate **Withdraw** tab. Withdrawals return the caller's own deposits to that same wallet without a new proof.

Changing amount, switching between deposit/withdraw or cancelling a proof invalidates the current UI proof. Changing the browser account/network clears the connection, pending request and proof; reconnect and generate a fresh proof for the selected account. Late relay results cannot restore an invalidated proof. Every successful deposit consumes its nonce and requires a fresh proof for the next deposit. The Vault accepts a proof for 15 minutes after the attestation check it carries (`attested_at`); after that the page asks for a new proof. Refreshing the page discards the in-memory proof and receipt; contract balances remain available after reconnecting.

The browser calls the relay directly through the SDK (`createSDK` in `lib/sdk.ts`), with no server of the demo's own in between; the relay allows every origin. Staging uses the staging relay. An ephemeral SDK signer authenticates the relay challenge. That signer does not control funds and is separate from the mobile KYC action signer and operational transaction signer. The SDK creates the request with `{ scope, action }` and polls every two seconds. Mobile deep links and callbacks retain the relay's public URL. The phone must be able to reach that relay. Browser reads use the public GIWA Sepolia RPC.

The page reads scope, nonce, domain and action hashes at the same block, constructs the typed action using the existing deposit amount, and cross-checks it against the deployed Vault before showing a QR code. A changed account, amount or consumed nonce requires a fresh proof. Fee bumps for the same action use the replacement receipt; cancellations and different replacement actions are not reported as successful transactions.

This is a testnet custody demo, not ERC-4626, a yield product or a KRW-backed instrument. The GIWA circuit uses the test attestation profile, not production Upbit KYC. Revocation and expiry come from a status statement the proving device signs: the attestation was neither revoked nor expired at `attested_at`, which the Vault requires to be within 900 s behind or 300 s ahead of the block. Public inputs and the operational wallet's transactions remain public; the KYC address itself is not submitted to the Vault. No onchain transactions are sent automatically on page load or on receipt of a mobile proof.

## Gotgan identity

The Gotgan tab, browser title, logo, vault labels, recipient name and mobile
proof request use the same brand. Brand assets live in `public/brand/gotgan-*`.
The mobile request uses the current demo origin for its icon, so staging requests retain staging branding URLs.
