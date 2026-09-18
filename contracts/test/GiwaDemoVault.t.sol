// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GiwaDemoVault} from "../src/GiwaDemoVault.sol";
import {DemoKRW} from "../src/DemoKRW.sol";

interface Vm {
    function chainId(uint256) external;
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
        return mode != 1 && keccak256(proof) == keccak256(hex"cafe") && inputs.length == 128;
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
    address constant VERIFIER = 0xEb9eb5452790Cfe549fF83CEB3Dbe1C432231492;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    uint256 constant AMOUNT = 10_000_000; // 10 dKRW
    GiwaDemoVault vault;
    DemoKRW token;

    function setUp() public {
        vm.chainId(91342);
        VerifierDouble verifier = new VerifierDouble();
        vm.etch(VERIFIER, address(verifier).code);
        token = new DemoKRW();
        vault = new GiwaDemoVault(address(token));
        token.mint(ALICE, 100_000_000);
        vm.prank(ALICE);
        token.approve(address(vault), type(uint256).max);
    }

    function _inputs(GiwaDemoVault target, address account, uint256 amount) internal view returns (bytes32[] memory p) {
        p = new bytes32[](128);
        bytes32[4] memory fields = [
            bytes32(uint256(1)),
            target.trustedSignerRoot(),
            keccak256(bytes(target.depositScope(account, amount))),
            bytes32(uint256(2))
        ];
        for (uint256 i; i < 128; ++i) {
            p[i] = bytes32(uint256(uint8(fields[i / 32][i % 32])));
        }
    }

    function _deposit(GiwaDemoVault target, address caller, uint256 amount, bytes32[] memory p) internal {
        vm.prank(caller);
        target.deposit(amount, hex"cafe", p);
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
        vault.deposit(AMOUNT, hex"", new bytes32[](0));
        require(vault.totalDeposits() == 0 && vault.nonces(BOB) == 0);
    }

    function testCopiedProofCannotBeUsedByAnotherWallet() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.WrongDepositScope.selector);
        _deposit(vault, BOB, AMOUNT, p);
    }

    function testAmountCannotBeChanged() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.WrongDepositScope.selector);
        _deposit(vault, ALICE, AMOUNT + 1, p);
    }

    function testAnotherVaultCannotUseProof() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        GiwaDemoVault other = new GiwaDemoVault(address(token));
        vm.expectRevert(GiwaDemoVault.WrongDepositScope.selector);
        _deposit(other, ALICE, AMOUNT, p);
    }

    function testAnotherChainCannotUseProof() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.chainId(1);
        vm.expectRevert(GiwaDemoVault.WrongDepositScope.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testReplayRejectedButFreshScopeWorks() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        _deposit(vault, ALICE, AMOUNT, p);
        vm.expectRevert(GiwaDemoVault.WrongDepositScope.selector);
        _deposit(vault, ALICE, AMOUNT, p);
        _deposit(vault, ALICE, AMOUNT, _inputs(vault, ALICE, AMOUNT));
        require(vault.nonces(ALICE) == 2 && vault.totalDeposits() == 2 * AMOUNT);
    }

    function testUntrustedIssuerRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        p[32] = bytes32(uint256(p[32]) ^ 1);
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
        VerifierDouble(VERIFIER).setMode(1);
        vm.expectRevert(GiwaDemoVault.InvalidProof.selector);
        _deposit(vault, ALICE, AMOUNT, p);
        require(vault.nonces(ALICE) == 0 && token.balanceOf(ALICE) == 100_000_000);
    }

    function testVerifierRevertRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        VerifierDouble(VERIFIER).setMode(2);
        vm.expectRevert(GiwaDemoVault.InvalidProof.selector);
        _deposit(vault, ALICE, AMOUNT, p);
    }

    function testTamperedProofRejected() public {
        bytes32[] memory p = _inputs(vault, ALICE, AMOUNT);
        vm.expectRevert(GiwaDemoVault.InvalidProof.selector);
        vm.prank(ALICE);
        vault.deposit(AMOUNT, hex"dead", p);
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
        vm.etch(VERIFIER, hex"");
        vm.expectRevert(abi.encodeWithSelector(GiwaDemoVault.ContractNotDeployed.selector, VERIFIER));
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
}
