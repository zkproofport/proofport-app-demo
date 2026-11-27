// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GiwaDemoVault} from "../src/GiwaDemoVault.sol";
import {DemoKRW} from "../src/DemoKRW.sol";

interface Vm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function expectCall(address, bytes calldata) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
}

// Tests exercise vault policy/accounting. This mock is NOT a cryptographic verifier.
contract VerifierDouble {
    uint256 public mode;

    function setMode(uint256 value) external {
        mode = value;
    }

    function verify(bytes calldata proof, bytes32[] calldata inputs) external view returns (bool) {
        require(mode != 2, "Verifier reverted");
        return mode != 1 && keccak256(proof) == keccak256(hex"cafe") && inputs.length == 133;
    }
}

contract AdversarialAsset {
    mapping(address => uint256) public balanceOf;
    GiwaDemoVault public vault;
    uint256 public mode;
    bool public reentryBlocked;

    function configure(GiwaDemoVault target, uint256 value) external {
        vault = target;
        mode = value;
    }

    function transferFrom(address, address to, uint256 amount) external returns (bool) {
        if (mode == 1) return false;
        if (mode == 2) {
            (bool success, bytes memory data) = address(vault).call(abi.encodeCall(vault.withdraw, (1)));
            reentryBlocked = !success && bytes4(data) == GiwaDemoVault.Reentrancy.selector;
        }
        balanceOf[to] += mode == 3 ? amount - 1 : amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (mode == 4) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract GiwaDemoVaultTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    // Written out, not read from the contract: circuits/deployments/91342/GiwaAttestationV2*.json.
    address constant VERIFIER_STANDARD = 0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE;
    address constant VERIFIER_ANDROID = 0x428074597be3D784535e40F9b1cDfe048AF57F03;
    address constant VERIFIER_ANDROID_FACTORY = 0x465FAB030D82241BD95268704537A782B8109807;
    // A realistic block time, so `NOW - 900` does not underflow.
    uint256 constant NOW = 1_795_000_000;
    // Written out, not read from the contract: core's getPinnedOprfKeyHash('staging', 'giwa_attestation').
    bytes32 constant TESTNET_OPRF_KEY_HASH = 0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1;
    // core's reduceOprfName("demo.zkproofport.app"); its raw keccak256 is above the field modulus.
    bytes32 constant DEMO_DOMAIN_FIELD = 0x0fd195923d45a11d40ac6c6d66108ede0763262945cd8c62a90491a5e3c13a32;
    uint256 constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    uint256 constant AMOUNT = 10_000_000; // 10 dKRW
    GiwaDemoVault vault;
    DemoKRW token;

    function setUp() public {
        vm.chainId(91342);
        vm.warp(NOW);
        bytes memory double = address(new VerifierDouble()).code;
        vm.etch(VERIFIER_STANDARD, double);
        vm.etch(VERIFIER_ANDROID, double);
        vm.etch(VERIFIER_ANDROID_FACTORY, double);
        token = new DemoKRW();
        vault = new GiwaDemoVault(address(token));
        token.mint(ALICE, 100_000_000);
        vm.prank(ALICE);
        token.approve(address(vault), type(uint256).max);
    }

    function _inputs(GiwaDemoVault target, address account, uint256 amount) internal view returns (bytes32[] memory p) {
        p = new bytes32[](133);
        bytes32[4] memory fields = [
            bytes32(0),
            _domain(address(target), block.chainid),
            _action(account, address(target.asset()), amount, target.nonces(account)),
            target.trustedSignerRoot()
        ];
        for (uint256 i; i < 128; ++i) {
            p[i] = bytes32(uint256(uint8(fields[i / 32][i % 32])));
        }
        p[128] = TESTNET_OPRF_KEY_HASH;
        p[129] = DEMO_DOMAIN_FIELD;
        p[130] = bytes32(uint256(keccak256(bytes(target.depositScope(account, amount)))) % P);
        p[131] = bytes32(uint256(2));
        p[132] = bytes32(block.timestamp);
    }

    function _domain(address target, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Gotgan"),
                keccak256("2"),
                chainId,
                target
            )
        );
    }

    function _action(address account, address asset, uint256 amount, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("Deposit(address account,address asset,uint256 amount,uint256 nonce)"),
                account,
                asset,
                amount,
                nonce
            )
        );
    }

    function _put(bytes32[] memory p, uint256 offset, bytes32 value) internal pure {
        for (uint256 i; i < 32; ++i) {
            p[offset + i] = bytes32(uint256(uint8(value[i])));
        }
    }

    function _deposit(GiwaDemoVault target, address caller, uint256 amount, bytes32[] memory p) internal {
        vm.prank(caller);
        target.deposit(amount, 0, hex"cafe", p);
    }

    function testDepositAndPartialWithdrawal() public {
        _deposit(vault, ALICE, AMOUNT, _inputs(vault, ALICE, AMOUNT));
        require(vault.balanceOf(ALICE) == AMOUNT && vault.totalDeposits() == AMOUNT);
        require(vault.nonces(ALICE) == 1 && token.balanceOf(address(vault)) == AMOUNT);
        vm.prank(ALICE);
        vault.withdraw(4_000_000);
        require(vault.balanceOf(ALICE) == 6_000_000 && vault.totalDeposits() == 6_000_000);
        require(token.balanceOf(ALICE) == 94_000_000);
    }

    function testMissingProofRejectedBeforeAllowance() public {
        vm.expectRevert(GiwaDemoVault.ProofRequired.selector);
        vm.prank(BOB);
        vault.deposit(AMOUNT, 0, hex"", new bytes32[](0));
        require(vault.totalDeposits() == 0 && vault.nonces(BOB) == 0);
    }

    function testCopiedProofCannotBeUsedByAnotherWallet() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
        _deposit(vault, BOB, AMOUNT, p);
    }

    function testAmountCannotBeChanged() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
        _deposit(vault, ALICE, AMOUNT + 1, p);
    }

    function testAnotherVaultCannotUseProof() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        GiwaDemoVault other = new GiwaDemoVault(address(token));
        vm.expectRevert(GiwaDemoVault.WrongDepositDomain.selector);
        _deposit(other, ALICE, AMOUNT, p);
    }

    function testAnotherChainCannotUseProof() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.chainId(1);
        vm.expectRevert(GiwaDemoVault.WrongDepositDomain.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testReplayRejectedButFreshScopeWorks() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _deposit(vault, ALICE, AMOUNT, p);
        vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
        _deposit(vault, ALICE, AMOUNT, p);
        _deposit(vault, ALICE, AMOUNT, _inputs(vault, ALICE, AMOUNT));
        require(vault.nonces(ALICE) == 2 && vault.totalDeposits() == 2 * AMOUNT);
    }

    function testUntrustedIssuerRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[96] = bytes32(uint256(p[96]) ^ 1);
        vm.expectRevert(GiwaDemoVault.UntrustedIssuer.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testNonCanonicalPublicInputRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[127] = bytes32(uint256(256));
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.InvalidPublicInputByte.selector, 127));
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testIncorrectInputCountRejected() public {
        vm.expectRevert(GiwaDemoVault.InvalidPublicInputCount.selector);
        _deposit(vault, ALICE, AMOUNT, new bytes32[](4));
    }

    function testFalseVerifierResultRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        VerifierDouble(VERIFIER_STANDARD).setMode(1);
        vm.expectRevert(GiwaDemoVault.InvalidProof.selector);
        _deposit(vault, ALICE, AMOUNT, p);
        require(vault.nonces(ALICE) == 0 && token.balanceOf(ALICE) == 100_000_000);
    }

    function testVerifierRevertRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        VerifierDouble(VERIFIER_STANDARD).setMode(2);
        vm.expectRevert(GiwaDemoVault.InvalidProof.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testTamperedProofRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.InvalidProof.selector);
        vm.prank(ALICE);
        vault.deposit(AMOUNT, 0, hex"dead", p);
    }

    function testCannotWithdrawAnotherUsersDeposit() public {
        _deposit(vault, ALICE, AMOUNT, _inputs(vault, ALICE, AMOUNT));
        vm.expectRevert(GiwaDemoVault.InsufficientBalance.selector);
        vm.prank(BOB);
        vault.withdraw(1);
    }

    function testRevertedTokenTransferRollsBackNonceAndBalance() public {
        vm.prank(ALICE);
        token.approve(address(vault), 0);
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.TokenTransferFailed.selector);
        _deposit(vault, ALICE, AMOUNT, p);
        require(vault.nonces(ALICE) == 0 && vault.balanceOf(ALICE) == 0 && vault.totalDeposits() == 0);
        vm.prank(ALICE);
        token.approve(address(vault), AMOUNT);
        _deposit(vault, ALICE, AMOUNT, p); // The same proof remains usable after a reverted transfer.
    }

    function testTokenReturningFalseRejected() public {
        AdversarialAsset asset = new AdversarialAsset();
        GiwaDemoVault target = new GiwaDemoVault(address(asset));
        asset.configure(target, 1);
        bytes32[] memory p = _inputs(target, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.TokenTransferFailed.selector);
        _deposit(target, ALICE, AMOUNT, p);
        require(target.totalDeposits() == 0 && target.nonces(ALICE) == 0);
    }

    function testTransferCallbackCannotReenter() public {
        AdversarialAsset asset = new AdversarialAsset();
        GiwaDemoVault target = new GiwaDemoVault(address(asset));
        asset.configure(target, 2);
        _deposit(target, ALICE, AMOUNT, _inputs(target, ALICE, AMOUNT));
        require(asset.reentryBlocked() && target.totalDeposits() == AMOUNT);
    }

    function testFeeOnTransferDepositRejected() public {
        AdversarialAsset asset = new AdversarialAsset();
        GiwaDemoVault target = new GiwaDemoVault(address(asset));
        asset.configure(target, 3);
        bytes32[] memory p = _inputs(target, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.UnsupportedToken.selector);
        _deposit(target, ALICE, AMOUNT, p);
        require(target.totalDeposits() == 0 && target.nonces(ALICE) == 0);
    }

    function testRevertedWithdrawalPreservesBalance() public {
        AdversarialAsset asset = new AdversarialAsset();
        GiwaDemoVault target = new GiwaDemoVault(address(asset));
        _deposit(target, ALICE, AMOUNT, _inputs(target, ALICE, AMOUNT));
        asset.configure(target, 4);
        vm.expectRevert(GiwaDemoVault.TokenTransferFailed.selector);
        vm.prank(ALICE);
        target.withdraw(AMOUNT);
        require(target.balanceOf(ALICE) == AMOUNT && target.totalDeposits() == AMOUNT);
    }

    function testWrongDeploymentChainRejected() public {
        vm.chainId(1);
        vm.expectRevert(GiwaDemoVault.WrongChain.selector);
        new GiwaDemoVault(address(token));
    }

    function testMissingVerifierRejected() public {
        address[3] memory verifiers = [VERIFIER_STANDARD, VERIFIER_ANDROID, VERIFIER_ANDROID_FACTORY];
        for (uint256 i; i < verifiers.length; ++i) {
            bytes memory code = verifiers[i].code;
            vm.etch(verifiers[i], hex"");
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.ContractNotDeployed.selector, verifiers[i]));
            new GiwaDemoVault(address(token));
            vm.etch(verifiers[i], code);
        }
        new GiwaDemoVault(address(token));
    }

    function testFuzzConservationAcrossDepositAndWithdrawal(uint96 rawAmount) public {
        uint256 amount = uint256(rawAmount) + 1;
        token.mint(BOB, amount);
        vm.prank(BOB);
        token.approve(address(vault), amount);
        _deposit(vault, BOB, amount, _inputs(vault, BOB, amount));
        require(vault.totalDeposits() == token.balanceOf(address(vault)));
        vm.prank(BOB);
        vault.withdraw(amount);
        require(vault.totalDeposits() == 0 && token.balanceOf(address(vault)) == 0);
        require(vault.balanceOf(BOB) == 0 && token.balanceOf(BOB) == amount);
    }

    function testDomainAndActionMatchIndependentEthersVectors() public {
        address fixedAsset = 0x2222222222222222222222222222222222222222;
        address fixedVault = 0x1111111111111111111111111111111111111111;
        vm.etch(fixedAsset, address(token).code);
        GiwaDemoVault deployed = new GiwaDemoVault(fixedAsset);
        vm.etch(fixedVault, address(deployed).code);
        GiwaDemoVault target = GiwaDemoVault(fixedVault);
        // ethers v6 TypedDataEncoder.hashDomain / hashStruct, independently generated.
        require(target.domainSeparator() == 0xd911a303a3cf684f484244806873a9f225fcf4efa08daa26d36ad8be14188aee);
        require(
            target.depositActionHash(ALICE, AMOUNT)
                == 0x11c9c871d6c8d7dc4c6b8b8e0bd514863d84b5106feff9f7381eadaa6d618fea
        );
    }

    function testOld128InputProofRejected() public {
        vm.expectRevert(GiwaDemoVault.InvalidPublicInputCount.selector);
        _deposit(vault, ALICE, AMOUNT, new bytes32[](128));
    }

    function testPreOprf192InputProofRejected() public {
        vm.expectRevert(GiwaDemoVault.InvalidPublicInputCount.selector);
        _deposit(vault, ALICE, AMOUNT, new bytes32[](192));
    }

    function testPinnedOprfKeyHashMatchesCore() public view {
        require(vault.OPRF_KEY_HASH() == TESTNET_OPRF_KEY_HASH);
        require(vault.oprfName(vault.OPRF_DOMAIN()) == DEMO_DOMAIN_FIELD);
        require(keccak256(bytes(vault.OPRF_DOMAIN())) == keccak256("demo.zkproofport.app"));
    }

    function testPinnedOprfKeyHashAccepted() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        require(p[128] == TESTNET_OPRF_KEY_HASH);
        require(vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p));
        _deposit(vault, ALICE, AMOUNT, p);
        require(vault.totalDeposits() == AMOUNT);
    }

    function testOtherOprfKeyHashRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[128] = bytes32(uint256(TESTNET_OPRF_KEY_HASH) ^ 1);
        vm.expectRevert(GiwaDemoVault.WrongOprfKey.selector);
        _deposit(vault, ALICE, AMOUNT, p);
        require(vault.nonces(ALICE) == 0 && vault.totalDeposits() == 0);
    }

    function testZeroOprfKeyHashRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[128] = bytes32(0);
        vm.expectRevert(GiwaDemoVault.WrongOprfKey.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testOprfKeyHashAtFieldModulusRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[128] = bytes32(uint256(TESTNET_OPRF_KEY_HASH) + P);
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.InvalidPublicInputField.selector, 128));
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testOtherOprfDomainRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[129] = bytes32(uint256(keccak256("stg-demo.zkproofport.app")) % P);
        vm.expectRevert(GiwaDemoVault.WrongOprfDomain.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testUnreducedOprfDomainRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[129] = keccak256("demo.zkproofport.app");
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.InvalidPublicInputField.selector, 129));
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testNullifierAtFieldModulusRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[131] = bytes32(P);
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.InvalidPublicInputField.selector, 131));
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testFuzzOnlyThePinnedKeyHashPasses(bytes32 keyHash) public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[128] = keyHash;
        if (keyHash == TESTNET_OPRF_KEY_HASH) {
            require(vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p));
        } else if (uint256(keyHash) >= P) {
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.InvalidPublicInputField.selector, 128));
            vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
        } else {
            vm.expectRevert(GiwaDemoVault.WrongOprfKey.selector);
            vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
        }
    }

    function testIdentityOnlyProofRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(p, 0, keccak256("identity challenge"));
        _put(p, 32, bytes32(0));
        _put(p, 64, bytes32(0));
        vm.expectRevert(GiwaDemoVault.IdentityProofNotAllowed.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testNonzeroSignalWithActionRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[31] = bytes32(uint256(1));
        vm.expectRevert(GiwaDemoVault.IdentityProofNotAllowed.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testEmptyDomainRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(p, 32, bytes32(0));
        vm.expectRevert(GiwaDemoVault.WrongDepositDomain.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testOtherDappDomainRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(
            p,
            32,
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256("Another app"),
                    keccak256("2"),
                    block.chainid,
                    address(vault)
                )
            )
        );
        vm.expectRevert(GiwaDemoVault.WrongDepositDomain.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testOldDomainVersionRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(
            p,
            32,
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256("Gotgan"),
                    keccak256("1"),
                    block.chainid,
                    address(vault)
                )
            )
        );
        vm.expectRevert(GiwaDemoVault.WrongDepositDomain.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testEmptyActionRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(p, 64, bytes32(0));
        vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testDifferentActionTypeRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(
            p,
            64,
            keccak256(
                abi.encode(
                    keccak256("Withdraw(address account,address asset,uint256 amount,uint256 nonce)"),
                    ALICE,
                    address(token),
                    AMOUNT,
                    uint256(0)
                )
            )
        );
        vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testWrongAssetInSignedActionRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(p, 64, _action(ALICE, address(0xBAD), AMOUNT, 0));
        vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testWrongNonceInSignedActionRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _put(p, 64, _action(ALICE, address(token), AMOUNT, 1));
        vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testScopeStillCheckedAfterSignedAction() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[130] = bytes32(uint256(keccak256("giwa-membership")) % P);
        vm.expectRevert(GiwaDemoVault.WrongDepositScope.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testReadOnlyPreflightDoesNotConsumeNonce() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        require(vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p));
        require(vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p));
        require(vault.nonces(ALICE) == 0 && vault.totalDeposits() == 0);
        _deposit(vault, ALICE, AMOUNT, p);
        require(vault.nonces(ALICE) == 1);
    }

    function testZeroAccountRejected() public {
        vm.expectRevert(GiwaDemoVault.ZeroAddress.selector);
        vault.verifyEligibility(address(0), AMOUNT, 0, hex"cafe", new bytes32[](133));
    }

    function testZeroDepositRejected() public {
        vm.expectRevert(GiwaDemoVault.ZeroAmount.selector);
        _deposit(vault, ALICE, 0, new bytes32[](133));
    }

    function testZeroWithdrawalRejected() public {
        vm.expectRevert(GiwaDemoVault.ZeroAmount.selector);
        vm.prank(ALICE);
        vault.withdraw(0);
    }

    function testMinimumDepositAndWithdrawal() public {
        _deposit(vault, ALICE, 1, _inputs(vault, ALICE, 1));
        vm.prank(ALICE);
        vault.withdraw(1);
        require(vault.totalDeposits() == 0 && vault.nonces(ALICE) == 1);
    }

    function testMaximumDepositAndWithdrawal() public {
        DemoKRW asset = new DemoKRW();
        GiwaDemoVault target = new GiwaDemoVault(address(asset));
        asset.mint(ALICE, type(uint256).max);
        vm.prank(ALICE);
        asset.approve(address(target), type(uint256).max);
        _deposit(target, ALICE, type(uint256).max, _inputs(target, ALICE, type(uint256).max));
        vm.prank(ALICE);
        target.withdraw(type(uint256).max);
        require(target.totalDeposits() == 0 && asset.balanceOf(ALICE) == type(uint256).max);
    }

    // ---------- signer packages: one verifier each ----------

    function _depositAs(uint8 variant, bytes32[] memory p) internal {
        vm.prank(ALICE);
        vault.deposit(AMOUNT, variant, hex"cafe", p);
    }

    function _verifiers() internal pure returns (address[3] memory) {
        return [VERIFIER_STANDARD, VERIFIER_ANDROID, VERIFIER_ANDROID_FACTORY];
    }

    function testPublishesTheThreeVerifiers() public view {
        require(vault.VERIFIER_STANDARD() == VERIFIER_STANDARD, "standard");
        require(vault.VERIFIER_ANDROID() == VERIFIER_ANDROID, "android");
        require(vault.VERIFIER_ANDROID_FACTORY() == VERIFIER_ANDROID_FACTORY, "android factory");
        require(
            vault.SIGNER_STANDARD() == 0 && vault.SIGNER_ANDROID() == 1 && vault.SIGNER_ANDROID_FACTORY() == 2, "ids"
        );
        for (uint8 v; v < 3; ++v) {
            require(vault.verifierFor(v) == _verifiers()[v], "verifierFor");
        }
        require(vault.PUBLIC_INPUT_COUNT() == 133, "count");
        require(vault.ATTESTED_AT_MAX_AGE() == 900 && vault.ATTESTED_AT_MAX_FUTURE() == 300, "windows");
    }

    // Only the selected package's verifier answers: the others are set to refuse, so a
    // deposit passes exactly when the call went to the selected one.
    function testEachVariantRoutesToItsOwnVerifier() public {
        address[3] memory verifiers = _verifiers();
        for (uint8 v; v < 3; ++v) {
            for (uint256 j; j < 3; ++j) {
                VerifierDouble(verifiers[j]).setMode(j == v ? 0 : 1);
            }
            bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
            vm.expectCall(verifiers[v], abi.encodeCall(VerifierDouble.verify, (hex"cafe", p)));
            _depositAs(v, p);
            require(vault.nonces(ALICE) == uint256(v) + 1, "nonce not consumed");
        }
        require(vault.totalDeposits() == 3 * AMOUNT, "deposits");
    }

    function testAProofIsRefusedOnAnotherPackagesVerifier() public {
        address[3] memory verifiers = _verifiers();
        for (uint8 v; v < 3; ++v) {
            for (uint256 j; j < 3; ++j) {
                VerifierDouble(verifiers[j]).setMode(j == v ? 1 : 0);
            }
            bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
            vm.expectRevert(GiwaDemoVault.InvalidProof.selector);
            _depositAs(v, p);
        }
        require(vault.nonces(ALICE) == 0 && vault.totalDeposits() == 0, "state moved");
    }

    function testUnknownVariantRejectedByName() public {
        uint8[4] memory unknown = [uint8(3), 4, 128, 255];
        for (uint256 i; i < unknown.length; ++i) {
            bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.UnknownSignerVariant.selector, unknown[i]));
            _depositAs(unknown[i], p);
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.UnknownSignerVariant.selector, unknown[i]));
            vault.verifyEligibility(ALICE, AMOUNT, unknown[i], hex"cafe", p);
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.UnknownSignerVariant.selector, unknown[i]));
            vault.verifierFor(unknown[i]);
        }
        require(vault.nonces(ALICE) == 0 && vault.totalDeposits() == 0, "state moved");
    }

    function testUnknownVariantReportedBeforeLayout() public {
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.UnknownSignerVariant.selector, uint8(3)));
        vault.verifyEligibility(ALICE, AMOUNT, 3, hex"cafe", new bytes32[](4));
    }

    function testVariantOutsideUint8IsNotAccepted() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        bytes memory data = abi.encodeCall(GiwaDemoVault.verifyEligibility, (ALICE, AMOUNT, 0, hex"cafe", p));
        // Overwrite the variant word (third argument) with 256, which no uint8 can hold.
        assembly {
            mstore(add(data, add(32, add(4, 64))), 256)
        }
        (bool success,) = address(vault).staticcall(data);
        require(!success, "variant 256 accepted");
    }

    function testFuzzOnlyKnownVariantsResolve(uint8 variant) public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        if (variant < 3) {
            require(vault.verifyEligibility(ALICE, AMOUNT, variant, hex"cafe", p), "known variant refused");
        } else {
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.UnknownSignerVariant.selector, variant));
            vault.verifyEligibility(ALICE, AMOUNT, variant, hex"cafe", p);
        }
    }

    function testNonceConsumedForEveryVariantAndProofNotReusable() public {
        for (uint8 v; v < 3; ++v) {
            bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
            _depositAs(v, p);
            vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
            _depositAs(v, p);
            // Nor under another package: the nonce in the signed action has moved on.
            vm.expectRevert(GiwaDemoVault.WrongDepositAction.selector);
            _depositAs((v + 1) % 3, p);
        }
        require(vault.nonces(ALICE) == 3, "nonce");
    }

    // ---------- layout: 133 inputs ----------

    function testOneInputShortOrOverRejected() public {
        uint256[2] memory counts = [uint256(132), 134];
        for (uint256 i; i < counts.length; ++i) {
            bytes32[] memory p = new bytes32[](counts[i]);
            bytes32[] memory full = _inputs(vault, ALICE, AMOUNT);
            for (uint256 j; j < counts[i] && j < full.length; ++j) {
                p[j] = full[j];
            }
            vm.expectRevert(GiwaDemoVault.InvalidPublicInputCount.selector);
            _deposit(vault, ALICE, AMOUNT, p);
        }
    }

    function testPreStatement132InputProofRejected() public {
        bytes32[] memory full = _inputs(vault, ALICE, AMOUNT);
        bytes32[] memory p = new bytes32[](132);
        for (uint256 j; j < 132; ++j) {
            p[j] = full[j];
        }
        vm.expectRevert(GiwaDemoVault.InvalidPublicInputCount.selector);
        vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
    }

    // ---------- attested_at freshness ----------

    function _at(uint256 attestedAt) internal view returns (bytes32[] memory p) {
        p = _inputs(vault, ALICE, AMOUNT);
        p[132] = bytes32(attestedAt);
    }

    function testAttestedAtExactlyMaxAgeAccepted() public {
        _deposit(vault, ALICE, AMOUNT, _at(NOW - 900));
        require(vault.nonces(ALICE) == 1, "not deposited");
    }

    function testAttestedAtOneSecondPastMaxAgeRejected() public {
        bytes32[] memory p = _at(NOW - 901);
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.AttestedAtTooOld.selector, NOW - 901, NOW));
        _deposit(vault, ALICE, AMOUNT, p);
        require(vault.nonces(ALICE) == 0 && vault.totalDeposits() == 0, "stale proof consumed the nonce");
    }

    function testAttestedAtExactlyMaxFutureAccepted() public {
        _deposit(vault, ALICE, AMOUNT, _at(NOW + 300));
        require(vault.nonces(ALICE) == 1, "not deposited");
    }

    function testAttestedAtOneSecondPastMaxFutureRejected() public {
        bytes32[] memory p = _at(NOW + 301);
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.AttestedAtInFuture.selector, NOW + 301, NOW));
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testAttestedAtZeroRejected() public {
        bytes32[] memory p = _at(0);
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.AttestedAtTooOld.selector, 0, NOW));
        vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
    }

    function testAProofGoesStaleWhileWaiting() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        require(vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p), "fresh proof refused");
        vm.warp(NOW + 900);
        require(vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p), "proof at the edge refused");
        vm.warp(NOW + 901);
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.AttestedAtTooOld.selector, NOW, NOW + 901));
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testAttestedAtMaxUint64IsInTheFuture() public {
        bytes32[] memory p = _at(type(uint64).max);
        vm.expectRevert(
            abi.encodeWithSelector(GiwaDemoVault.AttestedAtInFuture.selector, uint256(type(uint64).max), NOW)
        );
        vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
    }

    function testAttestedAtAtOrAbove2To64Rejected() public {
        uint256[3] memory wrong = [uint256(1) << 64, (uint256(1) << 64) + NOW, P - 1];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _at(wrong[i]);
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.AttestedAtNotUint64.selector, wrong[i]));
            vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
        }
    }

    function testAttestedAtAtOrAboveFieldModulusRejected() public {
        uint256[3] memory wrong = [P, P + NOW, type(uint256).max];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _at(wrong[i]);
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.InvalidPublicInputField.selector, 132));
            _deposit(vault, ALICE, AMOUNT, p);
        }
    }

    function testFuzzAttestedAtWindow(uint64 attestedAt) public {
        bytes32[] memory p = _at(attestedAt);
        if (uint256(attestedAt) + 900 < NOW) {
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.AttestedAtTooOld.selector, uint256(attestedAt), NOW));
            vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
        } else if (uint256(attestedAt) > NOW + 300) {
            vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.AttestedAtInFuture.selector, uint256(attestedAt), NOW));
            vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p);
        } else {
            require(vault.verifyEligibility(ALICE, AMOUNT, 0, hex"cafe", p), "in-window time refused");
        }
    }
}
