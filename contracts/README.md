# GIWA Sepolia Gotgan Vault v2

Deployed on 2026-09-23 KST to `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c` (chain 91342). Transaction: `0xcac293988fbc00d30082db58beec4c1fdb396c1b5811c769364bd1d359cca0da`, status 1. Source: `fe56978`. RPC readback confirmed the existing dKRW asset, new verifier and 192 public inputs.

This test ERC-20 vault checks both a GIWA KYC proof and an EIP-712 `Deposit` authorization. The KYC wallet signs the deposit action; the operational wallet sends the token approval, deposit, and withdrawal transactions. The vault provides custody only, with no yield, share token, or administrator withdrawal.

## Configuration and the original vault

| Setting | Value |
| --- | --- |
| Network | GIWA Sepolia, chain ID `91342` |
| Current GIWA verifier | `0x5Da234546874304F8c51BBEed00fC632938211c1` |
| Test issuer EOA | `0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b` |
| Trusted signer root | `0xad0e6d81c16211cd9d5d1580bbcea34f90a7dbf861530724a28bcba585360b92` |
| Existing dKRW asset | `0x417573024528f3c9daD782eF5316E992F3029e81` (6 decimals) |
| Original v1 vault | `0x18F72bF293E96117AF2641F304B5F1f274864EC8` |

**Deploy v2 at a new address.** The v1 vault cannot be upgraded: its verifier and 128-input layout are immutable. Deploying v2 does not change or transfer v1 balances, allowances, or withdrawal rights. A depositor can withdraw an existing v1 balance by connecting the original operational wallet to the [v1 contract explorer](https://sepolia-explorer.giwa.io/address/0x18F72bF293E96117AF2641F304B5F1f274864EC8?tab=contract) and calling `withdraw(amount)` on that address. The amount is in token base units and transaction ETH value is zero. The GIWA screen keeps its existing layout; there is no migration or legacy-vault selector. New v2 deposits need an allowance for the new address and a new proof.

## Typed deposit authorization

Use these exact domain values, type names, and ordered fields. Amounts are integer token base units, and `nonce` is the current `vault.nonces(account)` value.

```ts
const domain = {
  name: 'Gotgan',
  version: '2',
  chainId: 91342,
  verifyingContract: vaultAddress,
};
const types = {
  Deposit: [
    { name: 'account', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};
const message = {
  account: operationalWallet,
  asset: await vault.asset(),
  amount: amount.toString(),
  nonce: (await vault.nonces(operationalWallet)).toString(),
};
```

- `domainSeparator()` equals `TypedDataEncoder.hashDomain(domain)`.
- `depositActionHash(account, amount)` equals `TypedDataEncoder.hashStruct('Deposit', types, message)`. It is the struct hash, not the complete EIP-712 digest.
- The circuit verifies the KYC wallet's signature over `keccak256(0x1901 || domainSeparator || depositActionHash)`.
- Send the exact `depositScope(account, amount)` string in the same proof request. Do not hash it before sending it; the mobile circuit input preparation hashes it once.
- An identity-only proof cannot authorize a deposit, even when it proves valid KYC eligibility.

`depositScope` retains its existing format: `giwa-vault:v1:<64 lowercase hex characters>`. The suffix is `keccak256(abi.encode(chainId, vault, asset, account, amount, nonce))`. The `v1` names the scope format, independently of EIP-712 domain version `2`. The new vault address also changes the scope.

## Public inputs

| Indices | Field | Vault policy |
| --- | --- | --- |
| 0–31 | Signal hash | All zero: action mode is required |
| 32–63 | Domain separator | `Gotgan` version `2`, current chain and vault |
| 64–95 | Action hash | `Deposit(account, asset, amount, current nonce)` |
| 96–127 | Signer-list Merkle root | Pinned test issuer root |
| 128–159 | Scope | `keccak256(UTF8(depositScope result))` |
| 160–191 | Nullifier | Included in cryptographic verification |

Supply **192 bytes32 values, each containing one byte left-padded with zeros**. Do not combine them into six hashes or send the old 128-input layout. Use the 16,256-byte onchain proof already separated by the app, without prepending public inputs. The verifier's `verify(bytes,bytes32[])` may return false or revert; the vault converts both outcomes to `InvalidProof()`.

Each successful deposit increments the account nonce, preventing proof replay. A reverted deposit rolls back its nonce and balances. `verifyEligibility` is read-only and does not consume a nonce. Withdrawals need no new proof. The vault does not use nullifiers as permanent person identifiers or enforce one operational wallet per person.

## Deployment

- `src/GiwaDemoVault.sol`: self-contained vault source. Compile with Solidity **0.8.28**, optimizer **200 runs**, EVM **Cancun**.
- `src/DemoKRW.sol`: optional freely mintable test token. **It is not real KRW.** Reuse the existing asset when appropriate.
- `script/DeployGiwaDemoVault.s.sol`: deploys a new vault using an explicitly configured asset and checks the resulting configuration. The constructor rejects the wrong chain and missing asset/verifier bytecode.

Complete the repository's integration and deployment requirements before broadcasting. From `proofport-app-demo/contracts`, the following command **simulates only** and sends no chain transaction:

```sh
GIWA_VAULT_ASSET=0x417573024528f3c9daD782eF5316E992F3029e81 \
  forge script script/DeployGiwaDemoVault.s.sol:DeployGiwaDemoVault \
  --rpc-url https://sepolia-rpc.giwa.io \
  --sender <deployer-address>
```

For an authorized deployment, select a Foundry keystore with `--account <keystore-name>` and add `--broadcast`. Never put a private key in source, shell history, or documentation. `broadcast/` contains generated files and is excluded from Git. Record the actual deployed address and transaction hash, update the frontend configuration, and confirm `asset()`, `VERIFIER()`, `PUBLIC_INPUT_COUNT()`, and `domainSeparator()` through RPC. A simulated address is not a deployed contract, and the original vault address cannot serve as v2.

Remix may also compile the same source with the settings above and deploy with the token address as `assetAddress`. Transaction **ETH value is zero**; gas uses GIWA Sepolia test ETH.

## Manual integration checks

1. Fund the operational wallet with dKRW. Ten dKRW is `10000000` base units.
2. Attempt `deposit(amount, 0x, [])`. `ProofRequired()` must reject it without moving tokens. If gas estimation rejects it, do not describe it as a mined failed transaction.
3. Read the current scope and nonce, then request `giwa_attestation` with the typed action above. The mobile KYC wallet reviews and signs the deposit fields.
4. Validate the response request ID, circuit, chain, verifier, and all six public fields. Call `verifyEligibility(operationalWallet, amount, proof, publicInputs)` to check the actual verifier before transacting.
5. The operational wallet sends `token.approve(newVault, amount)` and `vault.deposit(amount, proof, publicInputs)` as separate wallet actions.
6. Check the successful receipt, `Deposited` event, vault balance, and incremented nonce. Reusing the same proof must fail.
7. Call `withdraw(amount)` and confirm funds return to the same operational wallet. Any original v1 balance remains withdrawable through the original contract separately.

## Tests and limitations

```sh
cd proofport-app-demo/contracts
forge test -vv
forge fmt --check
```

Foundry tests use a verifier double to exercise action, scope, issuer, replay, custody, token-failure rollback, and reentrancy policies. Fixed EIP-712 domain and struct-hash vectors are generated independently with ethers v6. The double does not generate or cryptographically verify proofs. A real mobile proof and wallet deposit/withdrawal remain part of the manual integration checks above.

The circuit checks a signed attestation transaction from the test `MockGiwaAttester` and the KYC wallet's signature. **This is not production Upbit KYC or production Dojang integration.** It does not prove chain inclusion, successful transaction execution, or current EAS expiry/revocation status. The KYC address is not a separate public argument, but the operational wallet, amount, nonce, and proof public inputs are public; this does not establish complete anonymity.

Only standard test ERC-20 assets are supported. Fee-on-transfer deposits are rejected; rebasing and other special token behavior are unsupported. Direct token transfers to the vault do not create deposit balances, and there is no administrator recovery function. A proof remains usable until its nonce is consumed; it has no separate expiry. This is not an externally audited production vault.
