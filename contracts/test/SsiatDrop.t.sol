// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SsiatDrop} from "../src/SsiatDrop.sol";
import {SsiatSeed} from "../src/SsiatSeed.sol";

interface Vm {
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectEmit() external;
    function expectCall(address, bytes calldata) external;
}

// Tests exercise drop policy and accounting. This double is NOT a cryptographic verifier.
contract DojangVerifierDouble {
    uint256 public mode;

    function setMode(uint256 value) external {
        mode = value;
    }

    function verify(bytes calldata proof, bytes32[] calldata inputs) external view returns (bool) {
        require(mode != 2, "Verifier reverted");
        return mode != 1 && keccak256(proof) == keccak256(hex"cafe") && inputs.length == 160;
    }
}

/// Etched over the drop's token to exercise the transfer-failure and reentrancy paths.
/// Behaviour comes from immutables because etching copies code, not storage.
contract AdversarialSeed {
    uint256 private immutable mode;
    SsiatDrop private immutable drop;

    constructor(uint256 value, SsiatDrop target) {
        mode = value;
        drop = target;
    }

    function balanceOf(address) external pure returns (uint256) {
        return type(uint128).max;
    }

    function transfer(address, uint256) external returns (bool) {
        if (mode == 1) return false;
        if (mode == 2) {
            (bool success, bytes memory data) =
                address(drop).call(abi.encodeCall(SsiatDrop.claim, (address(1), hex"cafe", new bytes32[](0))));
            // Only a Reentrancy refusal lets the outer claim finish.
            require(!success && bytes4(data) == SsiatDrop.Reentrancy.selector, "reentry was not refused");
            return true;
        }
        if (mode == 3) revert("transfer reverted");
        return true;
    }
}

contract SsiatDropTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant VERIFIER = 0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    bytes32 constant FAUCET_WALLET_1 = keccak256("faucet wallet 1 nullifier");
    bytes32 constant FAUCET_WALLET_2 = keccak256("faucet wallet 2 nullifier");
    uint256 constant CLAIM = 100 ether;
    uint256 constant SUPPLY = 1_000_000 ether;
    SsiatDrop drop;
    SsiatSeed seed;

    event Claimed(bytes32 indexed nullifier, address indexed recipient, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function setUp() public {
        vm.chainId(91342);
        DojangVerifierDouble verifier = new DojangVerifierDouble();
        vm.etch(VERIFIER, address(verifier).code);
        drop = new SsiatDrop(CLAIM, SUPPLY);
        seed = drop.token();
    }

    // ---------- helpers ----------

    function _domain(address target, string memory name, string memory version, uint256 chainId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                target
            )
        );
    }

    function _action(address recipient) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256("Claim(address recipient)"), recipient));
    }

    function _put(bytes32[] memory p, uint256 offset, bytes32 value) internal pure {
        for (uint256 i; i < 32; ++i) {
            p[offset + i] = bytes32(uint256(uint8(value[i])));
        }
    }

    /// Public inputs an honest prover would produce for `recipient` with this nullifier.
    function _inputs(SsiatDrop target, address recipient, bytes32 nullifier)
        internal
        view
        returns (bytes32[] memory p)
    {
        p = new bytes32[](160);
        _put(p, 32, _domain(address(target), "Ssiat", "1", block.chainid));
        _put(p, 64, _action(recipient));
        _put(p, 96, keccak256(bytes(target.claimScope())));
        _put(p, 128, nullifier);
    }

    function _claim(SsiatDrop target, address recipient, bytes32[] memory p) internal {
        target.claim(recipient, hex"cafe", p);
    }

    // ---------- the happy path ----------

    function testClaimPaysRecipientOnceAndRecordsNullifier() public {
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        require(seed.balanceOf(ALICE) == CLAIM, "recipient not paid");
        require(drop.claimed(FAUCET_WALLET_1), "nullifier not recorded");
        require(drop.totalClaims() == 1, "claim not counted");
        require(drop.remaining() == SUPPLY - CLAIM, "pool not reduced");
    }

    function testAnyoneMaySubmitButOnlyTheBoundRecipientIsPaid() public {
        vm.prank(BOB);
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        require(seed.balanceOf(ALICE) == CLAIM && seed.balanceOf(BOB) == 0, "wrong account paid");
    }

    function testTwoFaucetWalletsClaimIndependently() public {
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_2));
        require(seed.balanceOf(ALICE) == 2 * CLAIM && drop.totalClaims() == 2, "second wallet not paid");
    }

    function testClaimEmitsTransferThenClaimed() public {
        vm.expectEmit();
        emit Transfer(address(drop), ALICE, CLAIM);
        vm.expectEmit();
        emit Claimed(FAUCET_WALLET_1, ALICE, CLAIM);
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
    }

    function testVerifierReceivesExactlyTheSubmittedProofAndInputs() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.expectCall(VERIFIER, abi.encodeCall(DojangVerifierDouble.verify, (hex"cafe", p)));
        _claim(drop, ALICE, p);
    }

    function testPreflightDoesNotConsumeTheNullifier() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        require(drop.verifyClaim(ALICE, hex"cafe", p), "preflight refused");
        require(drop.verifyClaim(ALICE, hex"cafe", p), "preflight consumed state");
        require(!drop.claimed(FAUCET_WALLET_1) && drop.totalClaims() == 0, "preflight changed state");
        _claim(drop, ALICE, p);
    }

    // ---------- one claim per faucet wallet ----------

    function testDoubleClaimRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        _claim(drop, ALICE, p);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AlreadyClaimed.selector, FAUCET_WALLET_1));
        _claim(drop, ALICE, p);
        require(seed.balanceOf(ALICE) == CLAIM, "paid twice");
    }

    function testSameFaucetWalletCannotClaimAgainForAnotherRecipient() public {
        // The scope does not depend on the recipient, so a fresh proof for BOB carries the same nullifier.
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        bytes32[] memory forBob = _inputs(drop, BOB, FAUCET_WALLET_1);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AlreadyClaimed.selector, FAUCET_WALLET_1));
        _claim(drop, BOB, forBob);
    }

    function testPreflightReportsAlreadyClaimed() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        _claim(drop, ALICE, p);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AlreadyClaimed.selector, FAUCET_WALLET_1));
        drop.verifyClaim(ALICE, hex"cafe", p);
    }

    function testScopeIsFixedAndIndependentOfRecipient() public view {
        string memory scope = drop.claimScope();
        require(bytes(scope).length == 14 + 64, "scope length");
        require(
            keccak256(bytes(scope))
                == keccak256(
                    bytes(string.concat("ssiat-drop:v1:", _hex(keccak256(abi.encode(block.chainid, address(drop))))))
                ),
            "scope format"
        );
    }

    // ---------- recipient binding ----------

    function testProofForAliceCannotPayBob() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.expectRevert(SsiatDrop.WrongClaimAction.selector);
        _claim(drop, BOB, p);
        require(!drop.claimed(FAUCET_WALLET_1), "nullifier burnt by a refused claim");
    }

    function testZeroRecipientRejected() public {
        bytes32[] memory p = _inputs(drop, address(0), FAUCET_WALLET_1);
        vm.expectRevert(SsiatDrop.ZeroAddress.selector);
        _claim(drop, address(0), p);
    }

    function testEmptyActionRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        _put(p, 64, bytes32(0));
        vm.expectRevert(SsiatDrop.WrongClaimAction.selector);
        _claim(drop, ALICE, p);
    }

    function testOtherActionTypeRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        _put(p, 64, keccak256(abi.encode(keccak256("Deposit(address recipient)"), ALICE)));
        vm.expectRevert(SsiatDrop.WrongClaimAction.selector);
        _claim(drop, ALICE, p);
    }

    // ---------- proof shape ----------

    function testEmptyProofRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.expectRevert(SsiatDrop.ProofRequired.selector);
        drop.claim(ALICE, hex"", p);
    }

    function testWrongInputCountsRejected() public {
        uint256[5] memory counts = [uint256(0), 1, 159, 161, 192];
        for (uint256 i; i < counts.length; ++i) {
            vm.expectRevert(SsiatDrop.InvalidPublicInputCount.selector);
            _claim(drop, ALICE, new bytes32[](counts[i]));
        }
    }

    function testFieldAbove255RejectedAtFirstAndLastIndex() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[0] = bytes32(uint256(256));
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputByte.selector, 0));
        _claim(drop, ALICE, p);
        p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[159] = bytes32(type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputByte.selector, 159));
        _claim(drop, ALICE, p);
    }

    function testByte255IsAccepted() public {
        _claim(drop, ALICE, _inputs(drop, ALICE, bytes32(type(uint256).max)));
        require(drop.claimed(bytes32(type(uint256).max)), "0xff nullifier not recorded");
    }

    function testIdentityOnlyProofRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        _put(p, 0, keccak256("identity signal"));
        _put(p, 32, bytes32(0));
        _put(p, 64, bytes32(0));
        vm.expectRevert(SsiatDrop.IdentityProofNotAllowed.selector);
        _claim(drop, ALICE, p);
    }

    function testNonzeroSignalAlongsideActionRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[31] = bytes32(uint256(1));
        vm.expectRevert(SsiatDrop.IdentityProofNotAllowed.selector);
        _claim(drop, ALICE, p);
    }

    // ---------- domain and scope ----------

    function testOtherDomainsRejected() public {
        bytes32[4] memory wrong = [
            bytes32(0),
            _domain(address(drop), "Gotgan", "1", block.chainid),
            _domain(address(drop), "Ssiat", "2", block.chainid),
            _domain(address(0xD00D), "Ssiat", "1", block.chainid)
        ];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
            _put(p, 32, wrong[i]);
            vm.expectRevert(SsiatDrop.WrongClaimDomain.selector);
            _claim(drop, ALICE, p);
        }
    }

    function testAnotherChainCannotUseTheProof() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.chainId(1);
        vm.expectRevert(SsiatDrop.WrongClaimDomain.selector);
        _claim(drop, ALICE, p);
    }

    function testAnotherDropCannotUseTheProof() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        SsiatDrop other = new SsiatDrop(CLAIM, SUPPLY);
        vm.expectRevert(SsiatDrop.WrongClaimDomain.selector);
        _claim(other, ALICE, p);
    }

    function testWrongScopesRejected() public {
        bytes32[4] memory wrong = [
            bytes32(0),
            keccak256("proofport:dojang-playground"),
            keccak256(
                bytes(string.concat("ssiat-drop:v1:", _hex(keccak256(abi.encode(block.chainid, address(0xD00D))))))
            ),
            keccak256(abi.encode(block.chainid, address(drop)))
        ];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
            _put(p, 96, wrong[i]);
            vm.expectRevert(SsiatDrop.WrongClaimScope.selector);
            _claim(drop, ALICE, p);
        }
    }

    // ---------- the pool ----------

    function testPoolOfExactlyOneClaim() public {
        SsiatDrop small = new SsiatDrop(CLAIM, CLAIM);
        _claim(small, ALICE, _inputs(small, ALICE, FAUCET_WALLET_1));
        require(small.remaining() == 0, "pool not empty");
        bytes32[] memory second = _inputs(small, BOB, FAUCET_WALLET_2);
        vm.expectRevert(SsiatDrop.DropExhausted.selector);
        _claim(small, BOB, second);
    }

    function testRemainderSmallerThanAClaimIsNotPaid() public {
        SsiatDrop small = new SsiatDrop(CLAIM, CLAIM * 2 + 1);
        _claim(small, ALICE, _inputs(small, ALICE, FAUCET_WALLET_1));
        _claim(small, ALICE, _inputs(small, ALICE, FAUCET_WALLET_2));
        bytes32[] memory third = _inputs(small, BOB, keccak256("third"));
        vm.expectRevert(SsiatDrop.DropExhausted.selector);
        small.verifyClaim(BOB, hex"cafe", third);
        vm.expectRevert(SsiatDrop.DropExhausted.selector);
        _claim(small, BOB, third);
        require(small.remaining() == 1 && small.totalClaims() == 2, "remainder");
    }

    function testAlreadyClaimedIsReportedBeforeExhaustion() public {
        SsiatDrop small = new SsiatDrop(CLAIM, CLAIM);
        bytes32[] memory p = _inputs(small, ALICE, FAUCET_WALLET_1);
        _claim(small, ALICE, p);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AlreadyClaimed.selector, FAUCET_WALLET_1));
        _claim(small, ALICE, p);
    }

    // ---------- the verifier ----------

    function testVerifierReturningFalseRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        DojangVerifierDouble(VERIFIER).setMode(1);
        vm.expectRevert(SsiatDrop.InvalidProof.selector);
        _claim(drop, ALICE, p);
        require(!drop.claimed(FAUCET_WALLET_1) && seed.balanceOf(ALICE) == 0, "state changed");
    }

    function testVerifierRevertingRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        DojangVerifierDouble(VERIFIER).setMode(2);
        vm.expectRevert(SsiatDrop.InvalidProof.selector);
        _claim(drop, ALICE, p);
    }

    function testTamperedProofRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.expectRevert(SsiatDrop.InvalidProof.selector);
        drop.claim(ALICE, hex"dead", p);
    }

    // ---------- the token transfer ----------

    function testTokenReturningFalseRollsBackTheClaim() public {
        vm.etch(address(seed), address(new AdversarialSeed(1, drop)).code);
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.expectRevert(SsiatDrop.TokenTransferFailed.selector);
        _claim(drop, ALICE, p);
        require(!drop.claimed(FAUCET_WALLET_1) && drop.totalClaims() == 0, "nullifier kept after failure");
    }

    function testTokenRevertingRollsBackTheClaim() public {
        vm.etch(address(seed), address(new AdversarialSeed(3, drop)).code);
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.expectRevert(SsiatDrop.TokenTransferFailed.selector);
        _claim(drop, ALICE, p);
        require(!drop.claimed(FAUCET_WALLET_1), "nullifier kept after failure");
    }

    function testTransferCallbackCannotReenter() public {
        vm.etch(address(seed), address(new AdversarialSeed(2, drop)).code);
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        require(drop.claimed(FAUCET_WALLET_1) && drop.totalClaims() == 1, "reentry altered the claim");
    }

    // ---------- deployment ----------

    function testWholeSupplyStartsInTheDrop() public view {
        require(seed.totalSupply() == SUPPLY && seed.balanceOf(address(drop)) == SUPPLY, "supply");
        require(drop.remaining() == SUPPLY && drop.CLAIM_AMOUNT() == CLAIM, "config");
        require(keccak256(bytes(seed.name())) == keccak256("Ssiat Seed"), "name");
        require(keccak256(bytes(seed.symbol())) == keccak256("SEED") && seed.decimals() == 18, "symbol");
        require(
            drop.VERIFIER() == VERIFIER && drop.PUBLIC_INPUT_COUNT() == 160 && drop.CHAIN_ID() == 91342, "constants"
        );
    }

    function testTokenHasNoMint() public {
        (bool success,) = address(seed).call(abi.encodeWithSignature("mint(address,uint256)", ALICE, 1));
        require(!success, "token accepted a mint call");
        require(seed.totalSupply() == SUPPLY, "supply moved");
    }

    function testWrongDeploymentChainRejected() public {
        vm.chainId(1);
        vm.expectRevert(SsiatDrop.WrongChain.selector);
        new SsiatDrop(CLAIM, SUPPLY);
    }

    function testMissingVerifierRejected() public {
        vm.etch(VERIFIER, hex"");
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.ContractNotDeployed.selector, VERIFIER));
        new SsiatDrop(CLAIM, SUPPLY);
    }

    function testZeroClaimAmountRejected() public {
        vm.expectRevert(SsiatDrop.ZeroAmount.selector);
        new SsiatDrop(0, SUPPLY);
    }

    function testSupplyBelowOneClaimRejected() public {
        vm.expectRevert(SsiatDrop.SupplyBelowClaimAmount.selector);
        new SsiatDrop(CLAIM, CLAIM - 1);
    }

    function testSeedConstructorGuards() public {
        vm.expectRevert(SsiatSeed.ZeroAddress.selector);
        new SsiatSeed(address(0), 1);
        vm.expectRevert(SsiatSeed.ZeroSupply.selector);
        new SsiatSeed(ALICE, 0);
    }

    function testSeedTransfersAndAllowances() public {
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        vm.prank(ALICE);
        seed.approve(BOB, 40 ether);
        vm.prank(BOB);
        seed.transferFrom(ALICE, BOB, 40 ether);
        require(seed.balanceOf(BOB) == 40 ether && seed.allowance(ALICE, BOB) == 0, "transferFrom");
        vm.expectRevert(SsiatSeed.InsufficientAllowance.selector);
        vm.prank(BOB);
        seed.transferFrom(ALICE, BOB, 1);
        vm.expectRevert(SsiatSeed.InsufficientBalance.selector);
        vm.prank(ALICE);
        seed.transfer(BOB, 61 ether);
        vm.expectRevert(SsiatSeed.ZeroAddress.selector);
        vm.prank(ALICE);
        seed.transfer(address(0), 1);
    }

    // ---------- vectors shared with the demo's TypeScript tests ----------

    function testDomainActionAndScopeMatchIndependentEthersVectors() public {
        address fixedDrop = 0x1111111111111111111111111111111111111111;
        vm.etch(fixedDrop, address(drop).code);
        SsiatDrop target = SsiatDrop(fixedDrop);
        // ethers v6 TypedDataEncoder.hashDomain / hashStruct and keccak256(toUtf8Bytes(scope)),
        // the same values asserted in __tests__/ssiat-drop.test.ts.
        require(
            target.domainSeparator() == 0x23ab5e17f1fc30358e780537cd832a814bb55fa1bab072fc84c450088ecd89e7, "domain"
        );
        require(
            target.claimActionHash(ALICE) == 0xea55ff6513499a985fe58064fa898e3356e095ef50a294d4888eb0602a442b1e,
            "action"
        );
        require(
            keccak256(bytes(target.claimScope()))
                == keccak256("ssiat-drop:v1:c9530063dbdc15541fb42838f47b7e10008bb48373da7b5d1ac82fbdb6a20e12"),
            "scope"
        );
        require(
            keccak256(bytes(target.claimScope())) == 0xc69788fa294dd279cd16e71d89f1e5825e56babd7413eed1baf2db7ed1bf12f5,
            "scope hash"
        );
    }

    // ---------- conservation ----------

    function testFuzzClaimsConserveSupply(address recipient, bytes32 nullifier) public {
        if (recipient == address(0)) recipient = ALICE;
        _claim(drop, recipient, _inputs(drop, recipient, nullifier));
        require(drop.remaining() + seed.balanceOf(recipient) == SUPPLY || recipient == address(drop), "supply leaked");
        require(drop.claimed(nullifier) && drop.totalClaims() == 1, "claim not recorded");
    }

    function _hex(bytes32 value) internal pure returns (string memory) {
        bytes memory out = new bytes(64);
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i; i < 32; ++i) {
            out[2 * i] = alphabet[uint8(value[i]) >> 4];
            out[2 * i + 1] = alphabet[uint8(value[i]) & 15];
        }
        return string(out);
    }
}
