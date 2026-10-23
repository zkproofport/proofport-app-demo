# GIWA Sepolia Gotgan Vault v2

Current deployment, 2026-10-23 KST: `0x79e327731172EA4b522dD1c7Df6e61d1D3fB2620` (chain 91342), transaction `0xadb6093ebecd473bd9154f01e4c6e20cded2aacf045abe4ff1e6fad9a30df3c3`, status 1, block 39402056, deployer `0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c`. Same contract as before with one change: `VERIFIER` is the beta.19 GIWA verifier. RPC readback: `VERIFIER()` `0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3`, `PUBLIC_INPUT_COUNT()` 192, `asset()` the existing dKRW, `trustedSignerRoot()` the root below, `totalDeposits()` 0, `domainSeparator()` `0xd24805db0be0617dba4a0c082bf61eb6321637a370169dd3b6c8466faba9920d` (equal to ethers `TypedDataEncoder.hashDomain` for `Gotgan` / `2` / 91342 / this address).

**Why it was redeployed.** `VERIFIER` is a compile-time constant. The vault deployed on 2026-09-23 at `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c` (transaction `0xcac293988fbc00d30082db58beec4c1fdb396c1b5811c769364bd1d359cca0da`) points at `0x5Da234546874304F8c51BBEed00fC632938211c1`, the GIWA verifier built with the old toolchain, so it refuses every proof the beta.19 app produces. That vault is **retired** but unchanged: deposits in it stay withdrawable through its own `withdraw(uint256)`, exactly like v1 below.

Proof check at deployment, by `eth_call`: the circuits fixture proof for `giwa_attestation` (9,920 bytes, 192 public inputs) returns `true` from the new vault's verifier, and the same proof with one public input changed reverts. `verifyEligibility` on the new vault refuses that fixture with `WrongDepositDomain()`, as it must: the fixture is bound to a test domain, not to this vault. A proof bound to this vault comes from the phone flow below.

This test ERC-20 vault checks both a GIWA KYC proof and an EIP-712 `Deposit` authorization. The KYC wallet signs the deposit action; the operational wallet sends the token approval, deposit, and withdrawal transactions. The vault provides custody only, with no yield, share token, or administrator withdrawal.

## Configuration and the original vault

| Setting | Value |
| --- | --- |
| Network | GIWA Sepolia, chain ID `91342` |
| Current GIWA verifier (beta.19) | `0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3` (`circuits/deployments/91342/GiwaAttestation.json`) |
| Retired GIWA verifier (old toolchain) | `0x5Da234546874304F8c51BBEed00fC632938211c1` |
| Test issuer EOA | `0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b` |
| Trusted signer root | `0xad0e6d81c16211cd9d5d1580bbcea34f90a7dbf861530724a28bcba585360b92` |
| Existing dKRW asset | `0x417573024528f3c9daD782eF5316E992F3029e81` (6 decimals) |
| Original v1 vault | `0x18F72bF293E96117AF2641F304B5F1f274864EC8` |
| Retired v2 vault (old verifier) | `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c` |

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

Supply **192 bytes32 values, each containing one byte left-padded with zeros**. Do not combine them into six hashes or send the old 128-input layout. Use the onchain proof already separated by the app (9,920 bytes with the beta.19 toolchain; it was 16,256 with the old one), without prepending public inputs. The verifier's `verify(bytes,bytes32[])` may return false or revert; the vault converts both outcomes to `InvalidProof()`.

Each successful deposit increments the account nonce, preventing proof replay. A reverted deposit rolls back its nonce and balances. `verifyEligibility` is read-only and does not consume a nonce. Withdrawals need no new proof. The vault does not use nullifiers as permanent person identifiers or enforce one operational wallet per person.

## Deployment

- `src/GiwaDemoVault.sol`: self-contained vault source. Compile with Solidity **0.8.28**, optimizer **200 runs**, EVM **Cancun**.
- `src/DemoKRW.sol`: optional freely mintable test token. **It is not real KRW.** Reuse the existing asset when appropriate.
- `script/DeployGiwaDemoVault.s.sol`: deploys a new vault using an explicitly configured asset and checks the resulting configuration. The constructor rejects the wrong chain and missing asset/verifier bytecode.

Complete the repository's integration and deployment requirements before broadcasting. The script reads the deployer key with `vm.envUint("PRIVATE_KEY")`; export it from the env file in the same shell so it never appears on a command line (where `ps` would show it) and never type it. From `proofport-app-demo/contracts`, the following command **simulates only** and sends no chain transaction:

```sh
set -a; source ../../circuits/.env.development; set +a
export GIWA_VAULT_ASSET=0x417573024528f3c9daD782eF5316E992F3029e81
forge script script/DeployGiwaDemoVault.s.sol:DeployGiwaDemoVault \
  --rpc-url https://sepolia-rpc.giwa.io
```

For an authorized deployment, add `--broadcast`. Never put a private key in source, on a command line, in shell history, or in documentation, and do not list processes while a deploy runs. GIWA Sepolia's RPC lags between nodes: a simulation can fail with "failed to get block" or report a contract as missing (`ContractNotDeployed` for the dKRW asset, which does exist). Retry, but first check the deployer's nonce has not moved, so a retry can never send a second deployment. `broadcast/` contains generated files and is excluded from Git. Record the actual deployed address and transaction hash, update the frontend configuration, and confirm `asset()`, `VERIFIER()`, `PUBLIC_INPUT_COUNT()`, and `domainSeparator()` through RPC. A simulated address is not a deployed contract, and the original vault address cannot serve as v2.

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

Foundry tests use a verifier double etched at the verifier address, so a source still naming a retired verifier fails every test. `__tests__/verifier-deployments.test.ts` in the demo also checks that both contracts' `VERIFIER` and `PUBLIC_INPUT_COUNT` match the demo's verifier table, which is pinned to the circuits records. The tests use the double to exercise action, scope, issuer, replay, custody, token-failure rollback, and reentrancy policies. Fixed EIP-712 domain and struct-hash vectors are generated independently with ethers v6. The double does not generate or cryptographically verify proofs. A real mobile proof and wallet deposit/withdrawal remain part of the manual integration checks above.

The circuit checks a signed attestation transaction from the test `MockGiwaAttester` and the KYC wallet's signature. **This is not production Upbit KYC or production Dojang integration.** It does not prove chain inclusion, successful transaction execution, or current EAS expiry/revocation status. The KYC address is not a separate public argument, but the operational wallet, amount, nonce, and proof public inputs are public; this does not establish complete anonymity.

Only standard test ERC-20 assets are supported. Fee-on-transfer deposits are rejected; rebasing and other special token behavior are unsupported. Direct token transfers to the vault do not create deposit balances, and there is no administrator recovery function. A proof remains usable until its nonce is consumed; it has no separate expiry. This is not an externally audited production vault.

# Ssiat seed drop (GIWA Sepolia)

Current deployment, 2026-10-23 KST: drop `0xA7D93C4699e86AF9f60EcBe1A1D90297fcc57dFf`
(chain 91342), token `SEED` at `0x13269694b0c3f5f7C23A2009Da3a2503De724a77`.
Transaction `0x1da1c8df60047f79d3a008c173372ff6b1a68ec8385ae58badaaa2edf3e24ed4`,
status 1, block 39402079. Deployer `0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c`
(key from `circuits/.env.development`, exported by the shell and read by the
script with `vm.envUint`; never on a command line). RPC readback: `VERIFIER()`
`0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816` (beta.19 Dojang verifier),
`PUBLIC_INPUT_COUNT()` 160, `remaining()` 1,000,000 SEED, `totalClaims()` 0,
`CLAIM_AMOUNT()` 100 SEED, token `SEED` / 18 decimals with the whole supply in
the drop, `domainSeparator()`
`0xc16bdd5d09b9e483d7a5157f10c0b9a7da8076ff17e7291ba506d2a1408cd732`, `claimScope()`
`ssiat-drop:v1:2ed6472da94b57988b11e3d8239f5bef6bf31be1ef984cf4c9adac300479eacf`,
which `__tests__/ssiat-drop.test.ts` pins against `expectedSsiatScope`. The
circuits fixture proof for `dojang_playground` (9,536 bytes, 160 public inputs)
returns `true` from that verifier by `eth_call`; one changed public input reverts.

**Retired:** the drop deployed on 2026-10-14 at `0x3e10c391d5068DCc216dfA3A7ae2e27830204eBd`
(token `0x0165d1C1ad2c654D5e1c3B0Bf36568C89DB27aDf`, transaction
`0x75987d2e3c4af1a4474d47713be36e070870009f3c3ea6ab089cfd65b9cfb785`) has the
old-toolchain Dojang verifier `0x2d01C2fE3445B7DDE60118f956BB14E84Fd64724` compiled
in and refuses every beta.19 proof. It is left as it is; its SEED is valueless.
Its nullifiers do not carry over: the scope includes the drop address, so a
faucet wallet that claimed there can claim once from the new drop.

Ssiat (씨앗, "seed") is a fictional brand. `SsiatDrop` pays a fixed amount of
`SEED`, a valueless test token, once per GIWA Playground faucet wallet. It is
not a GIWA, Upbit or Dojang airdrop.

| Setting | Value |
| --- | --- |
| Network | GIWA Sepolia, chain ID `91342` |
| Verifier (`dojang_playground`, beta.19) | `0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816` (`circuits/deployments/91342/DojangPlayground.json`) |
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
The script reads the deployer key with `vm.envUint("PRIVATE_KEY")`, exported
from the env file in the same shell. This **simulates only**:

```sh
set -a; source ../../circuits/.env.development; set +a
forge script script/DeploySsiatDrop.s.sol:DeploySsiatDrop \
  --rpc-url https://sepolia-rpc.giwa.io
```

For the authorized deployment, add `--broadcast` to the same command.

The deployer needs GIWA Sepolia test ETH and nothing else; the transaction
value is zero. Never put a private key in a file, in this README, on a command
line or in shell history. GIWA Sepolia RPC lag: see the vault section above. The script asserts the verifier, the 160-input layout, the claim
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
