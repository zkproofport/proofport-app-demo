# GIWA Sepolia Gotgan Vault v2

Current deployment, 2026-11-27 KST: `0x41d707cD61847bB6939F3F1182eC96EFE6AaA983` (chain 91342), transaction `0xdc372e8177bf452c0be391a7e4a3a8e0ded5b8e42419fe32390f181419b9301a`, status 1, block 42423538, deployer `0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c`, deployed with `scripts/deploy-demo-contract.sh giwa-vault --broadcast`. It pins the three `giwa_attestation` v2 verifiers and the 133-input layout with `attested_at`. RPC readback: `VERIFIER_STANDARD()` `0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE`, `VERIFIER_ANDROID()` `0x428074597be3D784535e40F9b1cDfe048AF57F03`, `VERIFIER_ANDROID_FACTORY()` `0x465FAB030D82241BD95268704537A782B8109807` (`verifierFor(0/1/2)` returns the same three; `verifierFor(3)` reverts), `PUBLIC_INPUT_COUNT()` 133, `ATTESTED_AT_MAX_AGE()` 900, `ATTESTED_AT_MAX_FUTURE()` 300, `OPRF_KEY_HASH()` `0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1`, `OPRF_DOMAIN()` `demo.zkproofport.app`, `asset()` the existing dKRW, `trustedSignerRoot()` the root below, `totalDeposits()` 0, `domainSeparator()` `0x200092769c34e108672a08d60d305c4988f5d508dceb27ea172c33b2e5858193`.

**Why it was redeployed.** The verifiers, the public-input layout and the OPRF key hash are compile-time constants. The 2026-11-21 vault `0xAbc9a559967d6670257189B1dAd9d397f79a849e` (transaction `0xf6e1944753e7cf23b9a271456224126d0c7d458153bacc8c42b1b84c64f13b73`, block 41848318) points at the bb 6.0.0 verifier `0xA272056866453F0182426A29B9Ca6382d6C6a060` with the 132-input layout and no `signerVariant` argument. The 2026-10-23 vault `0x79e327731172EA4b522dD1c7Df6e61d1D3fB2620` (transaction `0xadb6093ebecd473bd9154f01e4c6e20cded2aacf045abe4ff1e6fad9a30df3c3`) points at the beta.19 verifier `0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3` with the 192-input layout, and the 2026-09-23 vault `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c` (transaction `0xcac293988fbc00d30082db58beec4c1fdb396c1b5811c769364bd1d359cca0da`) at the old-toolchain verifier `0x5Da234546874304F8c51BBEed00fC632938211c1`. All three refuse every proof the current app produces. They are **retired** but unchanged: deposits in each stay withdrawable through its own `withdraw(uint256)`, exactly like v1 below.

This test ERC-20 vault checks both a GIWA KYC proof and an EIP-712 `Deposit` authorization. The KYC wallet signs the deposit action; the operational wallet sends the token approval, deposit, and withdrawal transactions. The vault provides custody only, with no yield, share token, or administrator withdrawal.

## Configuration and the original vault

| Setting | Value |
| --- | --- |
| Network | GIWA Sepolia, chain ID `91342` |
| GIWA verifiers, one per signer package (`signerVariant` 0 / 1 / 2) | standard `0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE`, android `0x428074597be3D784535e40F9b1cDfe048AF57F03`, android_factory `0x465FAB030D82241BD95268704537A782B8109807` (`circuits/deployments/91342/GiwaAttestationV2.json`, `GiwaAttestationV2Android.json`, `GiwaAttestationV2AndroidFactory.json`) |
| Retired GIWA verifiers | `0xA272056866453F0182426A29B9Ca6382d6C6a060` (bb 6.0.0, 132-input layout), `0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3` (beta.19), `0x5Da234546874304F8c51BBEed00fC632938211c1` (old toolchain) |
| Test issuer EOA | `0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b` |
| Trusted signer root | `0xad0e6d81c16211cd9d5d1580bbcea34f90a7dbf861530724a28bcba585360b92` |
| Existing dKRW asset | `0x417573024528f3c9daD782eF5316E992F3029e81` (6 decimals) |
| Original v1 vault | `0x18F72bF293E96117AF2641F304B5F1f274864EC8` |
| Retired v2 vaults | `0x79e327731172EA4b522dD1c7Df6e61d1D3fB2620` (2026-10-23), `0x0036B61dBFaB8f3CfEEF77dD5D45F7EFBFE2035c` (2026-09-23) |

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
| 128 | OPRF key hash | `OPRF_KEY_HASH()`, the testnet key the ZKProofport core package pins for `giwa_attestation` |
| 129 | OPRF domain | `keccak256(UTF8(OPRF_DOMAIN())) mod p`, with `OPRF_DOMAIN()` = `demo.zkproofport.app` |
| 130 | Scope | `keccak256(UTF8(depositScope result)) mod p` |
| 131 | Nullifier | Included in cryptographic verification |
| 132 | `attested_at` | Unix seconds (u64) at which the device-signed status statement says the attestation was neither revoked nor expired; at most `ATTESTED_AT_MAX_AGE()` (900 s) behind and `ATTESTED_AT_MAX_FUTURE()` (300 s) ahead of `block.timestamp` |

`p` is the BN254 scalar field modulus (`FIELD_MODULUS()`); `oprfName(string)` returns the reduced value. Supply **133 bytes32 values**: indices 0–127 each hold one byte left-padded with zeros, and 128–132 each hold one whole field element below `p` (`InvalidPublicInputField(index)` otherwise, so a value cannot alias a smaller one inside the verifier). Index 132 must also fit in 64 bits (`AttestedAtNotUint64(value)`), and is refused with `AttestedAtTooOld(attestedAt, blockTimestamp)` when more than 900 s behind the block or `AttestedAtInFuture(attestedAt, blockTimestamp)` when more than 300 s ahead; a chain has no other clock for the statement. A request for this vault passes `oprfDomain: "demo.zkproofport.app"` beside the scope. Do not send the 132-input layout of proofs made before the status statement, the 192-input layout of proofs made before the OPRF nullifier, or the old 128-input layout. Use the onchain proof already separated by the app (9,920 bytes with the beta.19 toolchain; it was 16,256 with the old one), without prepending public inputs. The verifier's `verify(bytes,bytes32[])` may return false or revert; the vault converts both outcomes to `InvalidProof()`.

## Signer packages

Each circuit package has its own verifier, and a proof verifies only on the verifier of the package that made it. The relay result's `signerVariant` names that package; pass it as the `signerVariant` argument: `0` standard, `1` android, `2` android_factory (`SIGNER_STANDARD()`, `SIGNER_ANDROID()`, `SIGNER_ANDROID_FACTORY()`). `verifierFor(signerVariant)` returns the address used; any other value reverts with `UnknownSignerVariant(signerVariant)` and never resolves to another package's verifier. The three addresses are public as `VERIFIER_STANDARD()`, `VERIFIER_ANDROID()` and `VERIFIER_ANDROID_FACTORY()`, and the constructor refuses to deploy unless all three have bytecode.

```solidity
function verifyEligibility(address account, uint256 amount, uint8 signerVariant, bytes proof, bytes32[] publicInputs) view returns (bool)
function deposit(uint256 amount, uint8 signerVariant, bytes proof, bytes32[] publicInputs)
```

Each successful deposit increments the account nonce, preventing proof replay. A reverted deposit rolls back its nonce and balances. `verifyEligibility` is read-only and does not consume a nonce. Withdrawals need no new proof. The vault does not use nullifiers as permanent person identifiers or enforce one operational wallet per person.

## Deployment

- `src/GiwaDemoVault.sol`: self-contained vault source. Compile with Solidity **0.8.28**, optimizer **200 runs**, EVM **Cancun**.
- `src/DemoKRW.sol`: optional freely mintable test token. **It is not real KRW.** Reuse the existing asset when appropriate.
- `script/DeployGiwaDemoVault.s.sol`: deploys a new vault using an explicitly configured asset and checks the resulting configuration. The constructor rejects the wrong chain and missing asset/verifier bytecode.

Deploy with the repository script, run from anywhere in the workspace:

```sh
scripts/deploy-demo-contract.sh giwa-vault              # simulates only; sends nothing
scripts/deploy-demo-contract.sh giwa-vault --broadcast  # the authorized deployment
```

The script is the way to deploy this contract. It:

- reads the deployer key (`PRIVATE_KEY`) from `circuits/.env.development` into its own process environment; the deploy script reads it with `vm.envUint`, so the key never appears on a command line, in shell history or in a process listing;
- sets `GIWA_VAULT_ASSET` to the existing dKRW;
- simulates unless `--broadcast` is given;
- records the deployer's nonce before broadcasting and, if the broadcast fails, reports whether the nonce moved. GIWA Sepolia's RPC lags between nodes (a simulation can fail with "failed to get block", or report the dKRW asset as `ContractNotDeployed`); if the nonce moved, a transaction was sent, so inspect `broadcast/` before any retry rather than sending a second deployment;
- takes the new address from the broadcast record, waits up to two minutes for its bytecode, then reads `VERIFIER_STANDARD()`, `VERIFIER_ANDROID()`, `VERIFIER_ANDROID_FACTORY()`, `PUBLIC_INPUT_COUNT()`, `OPRF_KEY_HASH()`, `OPRF_DOMAIN()`, `asset()` and `domainSeparator()` back over RPC.

The deploy script itself also refuses a deployment whose three verifiers, input count, freshness windows, OPRF key hash, OPRF domain, asset or opening balance is not the expected one. `broadcast/` contains generated files and is excluded from Git. After broadcasting, record the address, transaction hash and block here and in `GIWA-VAULT-DEMO.md`, and set `VAULT_ADDRESS` in `lib/giwa-vault.ts`. A simulated address is not a deployed contract.

Remix may also compile the same source with the settings above and deploy with the token address as `assetAddress`. Transaction **ETH value is zero**; gas uses GIWA Sepolia test ETH.

## Manual integration checks

1. Fund the operational wallet with dKRW. Ten dKRW is `10000000` base units.
2. Attempt `deposit(amount, 0, 0x, [])`. `ProofRequired()` must reject it without moving tokens. If gas estimation rejects it, do not describe it as a mined failed transaction.
3. Read the current scope and nonce, then request `giwa_attestation` with the typed action above. The mobile KYC wallet reviews and signs the deposit fields.
4. Validate the response request ID, circuit, chain, signer package, verifier, and every public field. Call `verifyEligibility(operationalWallet, amount, signerVariant, proof, publicInputs)` to check the actual verifier before transacting.
5. The operational wallet sends `token.approve(newVault, amount)` and `vault.deposit(amount, signerVariant, proof, publicInputs)` as separate wallet actions, within 15 minutes of the proof's `attested_at`.
6. Check the successful receipt, `Deposited` event, vault balance, and incremented nonce. Reusing the same proof must fail.
7. Call `withdraw(amount)` and confirm funds return to the same operational wallet. Any original v1 balance remains withdrawable through the original contract separately.

## Tests and limitations

```sh
cd proofport-app-demo/contracts
forge test -vv
forge fmt --check
python3 ../scripts/mutate-demo-contract-guards.py   # breaks each signer-package and attested_at guard; every break must turn a test red
```

Foundry tests use a verifier double etched at each of the three verifier addresses, so a source still naming a retired verifier fails every test. `__tests__/verifier-deployments.test.ts` in the demo also checks both contracts' verifier constants and `PUBLIC_INPUT_COUNT` against the demo's verifier table, which is pinned to the circuits records. The tests use the doubles to exercise signer-package routing (each package reaches only its own verifier; an unknown package is refused by name), the `attested_at` window at both boundaries, action, scope, issuer, replay, custody, token-failure rollback, and reentrancy policies. Fixed EIP-712 domain and struct-hash vectors are generated independently with ethers v6. The double does not generate or cryptographically verify proofs. A real mobile proof and wallet deposit/withdrawal remain part of the manual integration checks above.

The circuit checks a signed attestation transaction from the test `MockGiwaAttester` and the KYC wallet's signature. **This is not production Upbit KYC or production Dojang integration.** It does not prove chain inclusion or successful transaction execution. Revocation and expiry are covered by a status statement the proving device signs after reading the attestation's EAS record: it says the attestation was neither revoked nor expired at `attested_at`, and the vault accepts that time only within 900 s behind or 300 s ahead of the block. The KYC address is not a separate public argument, but the operational wallet, amount, nonce, and proof public inputs are public; this does not establish complete anonymity.

Only standard test ERC-20 assets are supported. Fee-on-transfer deposits are rejected; rebasing and other special token behavior are unsupported. Direct token transfers to the vault do not create deposit balances, and there is no administrator recovery function. A proof remains usable until its nonce is consumed or its `attested_at` falls more than 900 s behind the block, whichever comes first. This is not an externally audited production vault.

# Ssiat seed drop (GIWA Sepolia)

Current deployment, 2026-11-27 KST: drop `0x55d63a1B8762bd4dbA30dcA74a4C138681FdCFd1`
(chain 91342), token `SEED` at `0x29EDa1b1a8D56380cEB88cB740EB1ddcbFCEf3AB`.
Transaction `0x44bcf5ab1c92ddd59a16612ce56bbbc604ebb50a0e5df2522f2ef2f8c5566a01`,
status 1, block 42423547. Deployer `0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c`,
deployed with `scripts/deploy-demo-contract.sh ssiat-drop --broadcast`. RPC
readback: `VERIFIER_STANDARD()` `0xC1c42ade7C31aFDf99FbaEDF97dA5b07fCCba724`,
`VERIFIER_ANDROID()` `0x7fc2059a73cEF2b572C8deEe911c72963dCB4A8a`,
`VERIFIER_ANDROID_FACTORY()` `0x0b3Af3DFc67dC65E0145c37ee00230139d579F64`
(`verifierFor(0/1/2)` returns the same three; `verifierFor(3)` reverts),
`PUBLIC_INPUT_COUNT()` 101, `ATTESTED_AT_MAX_AGE()` 900, `ATTESTED_AT_MAX_FUTURE()` 300,
`OPRF_KEY_HASH()` `0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1`,
`OPRF_DOMAIN()` `demo.zkproofport.app`, `remaining()` 1,000,000 SEED,
`totalClaims()` 0, `CLAIM_AMOUNT()` 100 SEED, `domainSeparator()`
`0x75b62280892f70768db18380b57191d1838c79cd0748b627d85fa351d7ddb13e`, `claimScope()`
`ssiat-drop:v1:f957370b63a0edd389c013b3a7e60f03309619c1f70f6b7488d144a21821220c`,
which `__tests__/ssiat-drop.test.ts` pins against `expectedSsiatScope`.

**Retired:** the 2026-11-21 drop `0x4691533b0981e03830ddcD76A3cd38d6CCB35235`
(token `0x32300B3de0964FC892013CDcd701b105E1A77A9C`, transaction
`0xaf53d1ea127779bcd5ab4df4a009d2062c8fd192b0fc412d32a8e3722a9cad23`, block
41848348) has the bb 6.0.0 Dojang verifier `0x400474E78a793289D091A5F556F78158956B5D01`
and the 100-input layout compiled in, with no `signerVariant` argument; the 2026-10-23 drop `0xA7D93C4699e86AF9f60EcBe1A1D90297fcc57dFf`
(token `0x13269694b0c3f5f7C23A2009Da3a2503De724a77`, transaction
`0x1da1c8df60047f79d3a008c173372ff6b1a68ec8385ae58badaaa2edf3e24ed4`) has the
beta.19 Dojang verifier `0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816` and the
160-input layout compiled in; the 2026-10-14 drop
`0x3e10c391d5068DCc216dfA3A7ae2e27830204eBd` (token
`0x0165d1C1ad2c654D5e1c3B0Bf36568C89DB27aDf`, transaction
`0x75987d2e3c4af1a4474d47713be36e070870009f3c3ea6ab089cfd65b9cfb785`) has the
old-toolchain verifier `0x2d01C2fE3445B7DDE60118f956BB14E84Fd64724`. All three refuse
every proof the current app produces and are left as they are; their SEED is
valueless. Nullifiers do not carry over: the scope includes the drop address,
so a faucet wallet that claimed from an earlier drop can claim once from the
current one.

Ssiat (씨앗, "seed") is a fictional brand. `SsiatDrop` pays a fixed amount of
`SEED`, a valueless test token, once per GIWA Playground faucet wallet. It is
not a GIWA, Upbit or Dojang airdrop.

| Setting | Value |
| --- | --- |
| Network | GIWA Sepolia, chain ID `91342` |
| Verifiers (`dojang_playground` v2), one per signer package (`signerVariant` 0 / 1 / 2) | standard `0xC1c42ade7C31aFDf99FbaEDF97dA5b07fCCba724`, android `0x7fc2059a73cEF2b572C8deEe911c72963dCB4A8a`, android_factory `0x0b3Af3DFc67dC65E0145c37ee00230139d579F64` (`circuits/deployments/91342/DojangPlaygroundV2.json`, `DojangPlaygroundV2Android.json`, `DojangPlaygroundV2AndroidFactory.json`) |
| Playground faucet the circuit requires | `0x63CCe2b569A7bC35895ee24306c1512fefc06121`, `payAndIssueEAS()` |
| Public inputs | 101: one byte per input for signal 0–31, domain 32–63, action 64–95; then whole field elements: OPRF key hash 96 (`OPRF_KEY_HASH()`), OPRF domain 97 (`OPRF_DOMAIN()` = `demo.zkproofport.app`, reduced mod p), scope 98 (`claimScope()` reduced mod p), nullifier 99, `attested_at` 100 (unix seconds, u64) |
| `attested_at` window | at most 900 s behind (`ATTESTED_AT_MAX_AGE()`) and 300 s ahead (`ATTESTED_AT_MAX_FUTURE()`) of `block.timestamp` |
| Claim amount / supply (deploy script) | 100 SEED / 1,000,000 SEED (10,000 claims) |

- `src/SsiatSeed.sol`: ERC-20 "Ssiat Seed" / `SEED`, 18 decimals. The whole
  supply is minted in the constructor to one holder; no mint, owner or admin.
- `src/SsiatDrop.sol`: deploys `SsiatSeed` in its own constructor so the full
  supply lands in the drop in one transaction. Rejects the wrong chain and a
  missing verifier (all three must have bytecode).
- Signer packages: a proof verifies only on the verifier of the package that
  made it. Pass the relay result's `signerVariant` as `0` standard, `1` android,
  `2` android_factory; `verifierFor(signerVariant)` returns the address used,
  and any other value reverts with `UnknownSignerVariant(signerVariant)`. The
  addresses are public as `VERIFIER_STANDARD()`, `VERIFIER_ANDROID()` and
  `VERIFIER_ANDROID_FACTORY()`.
- EIP-712 domain `Ssiat` / `1` / chain / drop address; action `Claim(address recipient)`.
  Binding the recipient stops a copied proof from being redirected.
- `claimScope()` is `ssiat-drop:v1:<64 lowercase hex of keccak256(abi.encode(chainId, drop))>`.
  It does not depend on the recipient: the nullifier is per (faucet wallet, scope),
  so a recipient-dependent scope would allow one claim per recipient. Send the
  string unhashed; the app hashes it once with `keccak256(UTF-8 bytes)`.
- `claim(recipient, signerVariant, proof, publicInputs)` may be sent by anyone
  and pays `recipient`. Checks, in order: zero recipient, empty proof, signer
  package (`UnknownSignerVariant`), input count, every byte field ≤ 255, every
  later field below p, zero signal, domain, `Claim(recipient)` hash, OPRF key
  and domain, scope, nullifier unused (`AlreadyClaimed`), pool ≥ claim amount
  (`DropExhausted`), `attested_at` within 64 bits (`AttestedAtNotUint64`) and
  the window (`AttestedAtTooOld` / `AttestedAtInFuture`, each with the time and
  the block time), then the package's verifier inside try/catch (`InvalidProof`
  for false or revert). The
  nullifier is marked before the transfer, under a reentrancy guard, and the
  transfer's return value is checked.
  `verifyClaim(recipient, signerVariant, proof, publicInputs)` runs the same
  checks as a read-only preflight.

**Limitation that decides what this drop may hold.** The circuit proves the
faucet wallet SIGNED a `payAndIssueEAS()` transaction to the faucet, not that
the transaction was mined or succeeded. The ZKProofport app checks inclusion
before proving, but a hand-built prover can sign an unbroadcast faucet call
from a fresh key, so "one claim per faucet wallet" is one claim per key, and
keys are free. SEED must stay valueless. The faucet wallet itself never
appears on chain; only its per-drop nullifier does.

## Deploying (operator only)

With the same repository script as the vault:

```sh
scripts/deploy-demo-contract.sh ssiat-drop              # simulates only; sends nothing
scripts/deploy-demo-contract.sh ssiat-drop --broadcast  # the authorized deployment
```

It reads the deployer key from `circuits/.env.development` (never on a command
line), guards a retry with the deployer's nonce, and reads `VERIFIER_STANDARD()`,
`VERIFIER_ANDROID()`, `VERIFIER_ANDROID_FACTORY()`, `PUBLIC_INPUT_COUNT()`, `OPRF_KEY_HASH()`, `OPRF_DOMAIN()`, `token()` and
`remaining()` back over RPC; see the vault section above. The deployer needs
GIWA Sepolia test ETH and nothing else; the transaction value is zero. The
deploy script asserts the three verifiers, the 101-input layout, the
freshness windows, the OPRF key hash
and domain, the claim amount, the token supply landing in the drop and the
token metadata, and emits `SsiatDropDeployed(drop, token, scope, domainSeparator)`.

After broadcasting:

1. Record the drop address, the token address (`drop.token()`), the
   transaction hash and the block here.
2. Set `SSIAT_DROP_ADDRESS` in `lib/ssiat-drop.ts`, and the pinned address and
   `claimScope()` in `__tests__/ssiat-drop.test.ts`. An empty or malformed
   `SSIAT_DROP_ADDRESS` makes `ssiatDropAddress()` throw; the tab never reads
   from or sends to a stand-in address.
3. Confirm through RPC: `CLAIM_AMOUNT()`, `claimScope()` (matches
   `expectedSsiatScope(drop)` in the demo) and `domainSeparator()`, beside the
   values the script already reads.

## Tests

```sh
cd proofport-app-demo/contracts
forge test --match-contract SsiatDropTest -vv
forge fmt --check
```

The verifier is a double etched at each of the three Dojang verifier
addresses: it does not generate or cryptographically verify proofs. The tests
cover signer-package routing, the `attested_at` window at both boundaries, and
nullifier replay across packages. Domain separator, `Claim` hash and scope hash
are pinned to vectors computed independently with ethers v6; the demo's
`__tests__/ssiat-drop.test.ts` asserts the same constants. A real phone proof
and a broadcast claim are covered by `e2e/ssiat-claim.test.ts`, not by these tests.
