# GIWA Sepolia Demo Vault

기존 GIWA eligibility verifier를 호출하는 테스트용 ERC-20 Vault입니다. 수익률·지분 토큰 없이 입금과 본인 잔액 출금만 제공합니다. 배포는 Remix에서 직접 진행합니다.

## 배포 파일

- `src/GiwaDemoVault.sol`: Vault. 외부 import 없이 단일 파일로 컴파일할 수 있습니다.
- `src/DemoKRW.sol`: 선택 사항인 6자리 소수점 테스트 토큰 `dKRW`. 누구나 mint할 수 있으며 **실제 KRW가 아닙니다**.

Vault는 다음 설정을 고정합니다.

| 항목 | 값 |
| --- | --- |
| 네트워크 | GIWA Sepolia, chain ID `91342` |
| Verifier | `0xEb9eb5452790Cfe549fF83CEB3Dbe1C432231492` |
| 테스트 issuer EOA | `0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b` |
| 신뢰하는 signer root | `0xad0e6d81c16211cd9d5d1580bbcea34f90a7dbf861530724a28bcba585360b92` |
| 입금 자산 | 생성자에 전달한 ERC-20 주소, 이후 변경 불가 |

Verifier의 [탐색기 ABI/소스](https://sepolia-explorer.giwa.io/address/0xeb9eb5452790cfe549ff83ceb3dbe1c432231492?tab=contract)를 확인했습니다. 공개 소스는 저장소의 `circuits/giwa-attestation/target/GiwaAttestation.sol`과 일치하며, 함수는 다음과 같습니다.

```solidity
function verify(bytes calldata proof, bytes32[] calldata publicInputs)
    external view returns (bool);
```

## Remix 배포와 수동 데모

1. 두 Solidity 파일을 Remix에 추가합니다. 컴파일러 **0.8.28**, optimizer **enabled / 200 runs**, EVM **Cancun**을 선택합니다.
2. 브라우저 지갑을 **GIWA Sepolia**에 연결하고 Remix의 브라우저 지갑 provider를 선택합니다. RPC는 `https://sepolia-rpc.giwa.io`입니다. 기본 Remix VM에서는 Vault가 `WrongChain()`으로 거절됩니다.
3. `DemoKRW`를 먼저 배포합니다. 생성자 인자는 없습니다. 이미 사용할 표준 ERC-20이 있다면 이 단계는 생략할 수 있습니다.
4. `GiwaDemoVault`를 배포하면서 `assetAddress`에 그 토큰 주소를 입력합니다. **검증기 주소는 생성자 인자가 아니며 소스에 고정되어 있습니다.**
5. `DemoKRW.mint(운용_지갑, 100000000)`으로 운용 지갑에 100 dKRW를 지급합니다. KYC용 지갑이 아닌, 실제 입금 트랜잭션을 보낼 지갑입니다.
6. **실패 장면:** 운용 지갑으로 Vault의 `deposit`을 호출합니다. `amount = 10000000`, `proof = 0x`, `publicInputs = []`. `ProofRequired()`로 거절되며 토큰은 이동하지 않습니다.
7. **증명 요청:** `depositScope(운용_지갑, 10000000)`을 읽고, 반환된 문자열을 그대로 모바일 `giwa_attestation` 요청의 `scope`로 전달합니다. 모바일에서는 attestation을 가진 KYC용 지갑으로 proof를 생성합니다.
8. 운용 지갑에서 토큰의 `approve(Vault_주소, 10000000)`을 호출합니다. 이는 proof를 대신하지 않으며, Vault가 토큰을 가져올 수 있게 하는 별도 승인입니다. 촬영 전에 미리 해두어도 됩니다.
9. **성공 장면:** 같은 운용 지갑에서 `deposit(10000000, proof, publicInputs)`을 다시 호출합니다. 모바일 응답의 proof와 128개 public input을 사용합니다. 검증 성공 시 `Deposited` 이벤트, `balanceOf(운용_지갑) = 10000000`, `totalDeposits` 증가를 확인합니다.
10. 원하면 `withdraw(10000000)`으로 출금합니다. 출금은 본인 잔액만 본인 운용 지갑으로 돌려주며 새 proof는 요구하지 않습니다.

모든 트랜잭션의 **ETH Value는 0**입니다. 토큰 금액은 정수 최소 단위입니다. 10 dKRW는 `10 × 10^6 = 10000000`이며, 다른 토큰이면 해당 decimals를 사용합니다. 가스는 GIWA Sepolia의 테스트 ETH로 지불합니다.

지갑/Remix가 gas estimation 단계에서 실패를 발견하면 트랜잭션이 전송되지 않을 수 있습니다. 이 경우 UI에는 "입금 요청 거절"로 표시하고, 채굴된 실패 트랜잭션으로 표현하지 않습니다. proof가 없는 경우는 Vault의 사전 검사에서, 잘못된 proof가 있는 경우는 실제 verifier 호출에서 거절됩니다.

## 프런트엔드 연결 규칙

Gotgan 화면은 `lib/useGiwaVault.ts`에서 `vault.depositScope(operationalWallet, amount)`를 읽어 GIWA proof를 요청합니다. 기존 community/membership scope로 만든 proof는 `WrongDepositScope()`로 거절됩니다. 실제 UI는 HTTP polling과 요청 취소·지갑 변경 처리를 포함합니다.

요청·HTTP polling·취소·지갑 트랜잭션 전체 흐름은 `lib/useGiwaVault.ts`를 참고합니다. 아래는 해당 요청에서 받은 `result`를 검증하고 컨트랙트 인자로 변환하는 부분입니다. `scope`는 요청할 때 읽은 값을 그대로 사용합니다.

```ts
import { toBeHex } from 'ethers';
import { prepareGiwaMembershipProof } from '@/lib/giwa-membership';

// requestId, circuit, chain, verifier, issuer root, scope를 확인합니다.
const checked = prepareGiwaMembershipProof(result, pending.requestId, scope);
const proofHex = checked.proof!;
const publicInputsHex = checked.publicInputs!.map(value => toBeHex(BigInt(value), 32));

// 읽기 전용 사전 확인: 정책과 실제 verifier를 모두 검사합니다.
await vault.verifyEligibility(operationalWallet, amount, proofHex, publicInputsHex);
```

이후 운용 지갑으로 `token.approve(vaultAddress, amount)`와 `vault.deposit(amount, proofHex, publicInputsHex)`를 각각 별도 사용자 동작으로 실행합니다. 거래 영수증은 `lib/giwa-vault.ts`의 `waitForVaultReceipt`로 확인하여 수수료 변경으로 대체된 거래도 처리합니다.

Remix에는 `proofHex`를 bytes로, `JSON.stringify(publicInputsHex)` 결과를 bytes32[]로 붙여 넣을 수 있습니다. publicInputs를 임의로 수정하거나 4개 해시로 합치면 안 됩니다.

| publicInputs 인덱스 | 의미 |
| --- | --- |
| 0–31 | signal hash |
| 32–63 | signer-list Merkle root |
| 64–95 | `keccak256(UTF8(scope 문자열))` |
| 96–127 | nullifier |

각 원소는 **1바이트 값을 32바이트로 왼쪽 0 패딩한 값**입니다. `proof`에는 public input을 앞에 붙이지 않습니다. 이 배포된 verifier의 proof 길이는 16,256바이트이며, 앱에서 이미 분리한 onchain proof를 사용합니다.

scope는 `giwa-vault:v1:` 뒤에 action hash의 소문자 64자리 hex를 붙인 문자열입니다. action hash는 `keccak256(abi.encode(chainId, vault, asset, operationalWallet, amount, nonce))`입니다. 임의 계산 대신 컨트랙트의 반환값을 쓰는 것이 가장 간단합니다. scope를 먼저 해시해서 모바일에 전달하면 이중 해시가 되므로 실패합니다.

입금 성공마다 해당 지갑의 nonce가 증가합니다. 지갑·금액·Vault가 바뀌거나 다음 입금을 하려면 새 scope로 proof를 생성해야 합니다. 실패한 트랜잭션은 nonce를 소비하지 않습니다. `verifyEligibility`도 nonce를 소비하지 않습니다. nullifier를 사람별 영구 식별자나 한 사람당 한 지갑 제한으로 사용하지 않습니다.

## 검증 범위와 제한

- 현재 회로는 `MockGiwaAttester` 대상의 서명된 attestation 트랜잭션과 사용자 키 소유를 검증합니다. **실제 Upbit production KYC / production Dojang 연동이 아닙니다.**
- 회로 자체는 트랜잭션의 체인 포함·실행 성공이나 현재 EAS 만료·철회 상태를 검증하지 않습니다. 이 Vault도 그 기능을 추가하지 않습니다.
- Vault는 원본 KYC 계정 주소를 별도 인자로 받지 않습니다. 다만 운용 지갑, 입금액, proof의 public inputs는 공개됩니다. 특히 기존 앱의 signal hash는 KYC 주소와 scope 등으로 결정되므로, 알려진 주소 후보를 통한 상관관계 추정까지 차단한다고 주장할 수 없습니다.
- 이 계약은 표준 전송 방식의 테스트 ERC-20용입니다. fee-on-transfer 입금은 거절하며, rebasing 등 특수 토큰은 지원하지 않습니다. 관리자의 자산 회수 기능은 없고, Vault 주소로 직접 토큰을 보내면 입금 잔액으로 인정되지 않습니다.
- proof는 해당 nonce가 소비될 때까지 유효하며 별도 만료 시간이 없습니다. 외부 감사를 받은 production Vault가 아닙니다.

## 테스트

```sh
cd proofport-app-demo/contracts
forge test -vv
```

Solidity 0.8.28로 컴파일하고 **22개 테스트(128회 fuzz 포함)**를 통과했습니다. 실제 verifier의 공개 ABI/소스 확인 및 GIWA Sepolia `eth_call`로 잘못된 proof의 `ProofLengthWrong()` revert도 확인했습니다. 배포나 state-changing 트랜잭션은 전송하지 않았습니다.

로컬 테스트는 verifier double을 사용해 Vault의 정책·잔액·재사용 방지·재진입 방지를 검사합니다. 모바일 proof와 실제 지갑을 이용한 입출금은 이 테스트에 포함되지 않습니다. 데모 전 위 순서로 최종 연동을 별도 확인합니다.
