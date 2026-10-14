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

# Ssiat seed drop (GIWA Sepolia)

Deployed on 2026-10-14 KST to `0x3e10c391d5068DCc216dfA3A7ae2e27830204eBd`
(chain 91342), token `SEED` at `0x0165d1C1ad2c654D5e1c3B0Bf36568C89DB27aDf`.
Transaction `0x75987d2e3c4af1a4474d47713be36e070870009f3c3ea6ab089cfd65b9cfb785`,
status 1, block 38636909. Deployer `0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c`
(the wallet that deployed the Dojang verifier; key from `circuits/.env.development`,
passed as `--private-key "$PRIVATE_KEY"` from the sourced file, never typed).
RPC readback: `VERIFIER()` is the Dojang verifier, `remaining()` 1,000,000 SEED,
`CLAIM_AMOUNT()` 100 SEED, `claimScope()`
`ssiat-drop:v1:1a79a3d73bcc0c6354b075a1f1fc9dab0fa3d7f925a46de6d7f1deb6940ff8f1`,
which `__tests__/ssiat-drop.test.ts` pins against `expectedSsiatScope`.

Ssiat (씨앗, "seed") is a fictional brand. `SsiatDrop` pays a fixed amount of
`SEED`, a valueless test token, once per GIWA Playground faucet wallet. It is
not a GIWA, Upbit or Dojang airdrop.

| Setting | Value |
| --- | --- |
| Network | GIWA Sepolia, chain ID `91342` |
| Verifier (`dojang_playground`) | `0x2d01C2fE3445B7DDE60118f956BB14E84Fd64724` (`circuits/deployments/91342/DojangPlayground.json`) |
| Playground faucet the circuit requires | `0x63CCe2b569A7bC35895ee24306c1512fefc06121`, `payAndIssueEAS()` |
| Public inputs | 160, one byte per field: signal 0–31, domain 32–63, action 64–95, scope 96–127, nullifier 128–159 |
| Claim amount / supply (deploy script) | 100 SEED / 1,000,000 SEED (10,000 claims) |

- `src/SsiatSeed.sol`: ERC-20 "Ssiat Seed" / `SEED`, 18 decimals. The whole
  supply is minted in the constructor to one holder; no mint, owner or admin.
- `src/SsiatDrop.sol`: deploys `SsiatSeed` in its own constructor so the full
  supply lands in the drop in one transaction. Rejects the wrong chain and a
  missing verifier.
- EIP-712 domain `Ssiat` / `1` / chain / drop address; action `Claim(address recipient)`.
  Binding the recipient stops a copied proof from being redirected.
- `claimScope()` is `ssiat-drop:v1:<64 lowercase hex of keccak256(abi.encode(chainId, drop))>`.
  It does not depend on the recipient: the nullifier is per (faucet wallet, scope),
  so a recipient-dependent scope would allow one claim per recipient. Send the
  string unhashed; the app hashes it once with `keccak256(UTF-8 bytes)`.
- `claim(recipient, proof, publicInputs)` may be sent by anyone and pays
  `recipient`. Checks, in order: zero recipient, empty proof, input count,
  every field ≤ 255, zero signal, domain, `Claim(recipient)` hash, scope,
  nullifier unused (`AlreadyClaimed`), pool ≥ claim amount (`DropExhausted`),
  then the verifier inside try/catch (`InvalidProof` for false or revert). The
  nullifier is marked before the transfer, under a reentrancy guard, and the
  transfer's return value is checked. `verifyClaim` runs the same checks as a
  read-only preflight.

**Limitation that decides what this drop may hold.** The circuit proves the
faucet wallet SIGNED a `payAndIssueEAS()` transaction to the faucet, not that
the transaction was mined or succeeded. The ZKProofport app checks inclusion
before proving, but a hand-built prover can sign an unbroadcast faucet call
from a fresh key, so "one claim per faucet wallet" is one claim per key, and
keys are free. SEED must stay valueless. The faucet wallet itself never
appears on chain; only its per-drop nullifier does.

## Deploying (operator only)

From `proofport-app-demo/contracts`, with Foundry 1.4.3 (`forge --version`).
The script takes no environment variables. This **simulates only**:

```sh
forge script script/DeploySsiatDrop.s.sol:DeploySsiatDrop \
  --rpc-url https://sepolia-rpc.giwa.io \
  --sender <deployer-address>
```

For the authorized deployment, sign with a Foundry keystore and add `--broadcast`:

```sh
forge script script/DeploySsiatDrop.s.sol:DeploySsiatDrop \
  --rpc-url https://sepolia-rpc.giwa.io \
  --account <keystore-name> --sender <deployer-address> \
  --broadcast
```

The deployer needs GIWA Sepolia test ETH and nothing else; the transaction
value is zero. Never put a private key in a file, in this README or in shell
history. The script asserts the verifier, the 160-input layout, the claim
amount, the token supply landing in the drop and the token metadata, and emits
`SsiatDropDeployed(drop, token, scope, domainSeparator)`.

After broadcasting:

1. Record the drop address, the token address (`drop.token()`) and the
   transaction hash here.
2. Set `SSIAT_DROP_ADDRESS` in `lib/ssiat-drop.ts`. Until it is set, the Ssiat
   tab shows "Drop not deployed yet" and `ssiatDropAddress()` throws; it never
   reads from or sends to a stand-in address.
3. Confirm through RPC: `VERIFIER()`, `PUBLIC_INPUT_COUNT()` = 160,
   `CLAIM_AMOUNT()`, `remaining()`, `claimScope()` (matches
   `expectedSsiatScope(drop)` in the demo), and `domainSeparator()`.

## Tests

```sh
cd proofport-app-demo/contracts
forge test --match-contract SsiatDropTest -vv
forge fmt --check
```

The verifier is a double etched at the Dojang address: it does not generate or
cryptographically verify proofs. Domain separator, `Claim` hash and scope hash
are pinned to vectors computed independently with ethers v6; the demo's
`__tests__/ssiat-drop.test.ts` asserts the same constants. A real phone proof
and a broadcast claim have not been exercised; they need the deployed drop.
