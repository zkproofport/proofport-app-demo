// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SsiatDrop} from "../src/SsiatDrop.sol";
import {SsiatSeed} from "../src/SsiatSeed.sol";

interface Vm {
    function chainId(uint256) external;
    function warp(uint256) external;
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
        return mode != 1 && keccak256(proof) == keccak256(hex"cafe") && inputs.length == 101;
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
                address(drop).call(abi.encodeCall(SsiatDrop.claim, (address(1), uint8(0), hex"cafe", new bytes32[](0))));
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
    // Written out, not read from the contract: circuits/deployments/91342/DojangPlaygroundV2*.json.
    address constant VERIFIER_STANDARD = 0xC1c42ade7C31aFDf99FbaEDF97dA5b07fCCba724;
    address constant VERIFIER_ANDROID = 0x7fc2059a73cEF2b572C8deEe911c72963dCB4A8a;
    address constant VERIFIER_ANDROID_FACTORY = 0x0b3Af3DFc67dC65E0145c37ee00230139d579F64;
    // A realistic block time, so `NOW - 900` does not underflow.
    uint256 constant NOW = 1_795_000_000;
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    uint256 constant P = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Written out, not read from the contract: core's getPinnedOprfKeyHash('staging', 'dojang_playground').
    bytes32 constant TESTNET_OPRF_KEY_HASH = 0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1;
    // core's reduceOprfName("demo.zkproofport.app"); its raw keccak256 is above the field modulus.
    bytes32 constant DEMO_DOMAIN_FIELD = 0x0fd195923d45a11d40ac6c6d66108ede0763262945cd8c62a90491a5e3c13a32;
    // An OPRF nullifier is a field element.
    bytes32 constant FAUCET_WALLET_1 = bytes32(uint256(keccak256("faucet wallet 1 nullifier")) % P);
    bytes32 constant FAUCET_WALLET_2 = bytes32(uint256(keccak256("faucet wallet 2 nullifier")) % P);
    uint256 constant CLAIM = 100 ether;
    uint256 constant SUPPLY = 1_000_000 ether;
    SsiatDrop drop;
    SsiatSeed seed;

    event Claimed(bytes32 indexed nullifier, address indexed recipient, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function setUp() public {
        vm.chainId(91342);
        vm.warp(NOW);
        bytes memory double = address(new DojangVerifierDouble()).code;
        vm.etch(VERIFIER_STANDARD, double);
        vm.etch(VERIFIER_ANDROID, double);
        vm.etch(VERIFIER_ANDROID_FACTORY, double);
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
        p = new bytes32[](101);
        _put(p, 32, _domain(address(target), "Ssiat", "1", block.chainid));
        _put(p, 64, _action(recipient));
        p[96] = TESTNET_OPRF_KEY_HASH;
        p[97] = DEMO_DOMAIN_FIELD;
        p[98] = bytes32(uint256(keccak256(bytes(target.claimScope()))) % P);
        p[99] = nullifier;
        p[100] = bytes32(block.timestamp);
    }

    function _claim(SsiatDrop target, address recipient, bytes32[] memory p) internal {
        target.claim(recipient, 0, hex"cafe", p);
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
        vm.expectCall(VERIFIER_STANDARD, abi.encodeCall(DojangVerifierDouble.verify, (hex"cafe", p)));
        _claim(drop, ALICE, p);
    }

    function testPreflightDoesNotConsumeTheNullifier() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        require(drop.verifyClaim(ALICE, 0, hex"cafe", p), "preflight refused");
        require(drop.verifyClaim(ALICE, 0, hex"cafe", p), "preflight consumed state");
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
        drop.verifyClaim(ALICE, 0, hex"cafe", p);
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
        drop.claim(ALICE, 0, hex"", p);
    }

    function testWrongInputCountsRejected() public {
        uint256[7] memory counts = [uint256(0), 1, 99, 100, 102, 160, 192];
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
        p[95] = bytes32(type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputByte.selector, 95));
        _claim(drop, ALICE, p);
    }

    function testByte255IsAccepted() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[95] = bytes32(uint256(255));
        p[94] = bytes32(uint256(255));
        // The action's last bytes changed, so the action check refuses; the byte check let it through.
        vm.expectRevert(SsiatDrop.WrongClaimAction.selector);
        _claim(drop, ALICE, p);
    }

    function testLargestNullifierIsAccepted() public {
        _claim(drop, ALICE, _inputs(drop, ALICE, bytes32(P - 1)));
        require(drop.claimed(bytes32(P - 1)), "p - 1 nullifier not recorded");
    }

    // A verifier reduces a public input modulo the field, so `n` and `n + P` would be one proof
    // under two nullifiers -- a second claim from the same faucet wallet.
    function testNullifierAtOrAboveTheModulusRejected() public {
        bytes32[3] memory wrong = [bytes32(P), bytes32(uint256(FAUCET_WALLET_1) + P), bytes32(type(uint256).max)];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _inputs(drop, ALICE, wrong[i]);
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputField.selector, 99));
            _claim(drop, ALICE, p);
        }
    }

    function testAliasOfAClaimedNullifierRejected() public {
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        bytes32[] memory aliased = _inputs(drop, ALICE, bytes32(uint256(FAUCET_WALLET_1) + P));
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputField.selector, 99));
        _claim(drop, ALICE, aliased);
        require(drop.totalClaims() == 1, "alias claimed twice");
    }

    // ---------- the OPRF key and domain ----------

    function testPinnedOprfKeyHashMatchesCore() public view {
        require(drop.OPRF_KEY_HASH() == TESTNET_OPRF_KEY_HASH, "key hash");
        require(drop.oprfName(drop.OPRF_DOMAIN()) == DEMO_DOMAIN_FIELD, "domain field");
        require(keccak256(bytes(drop.OPRF_DOMAIN())) == keccak256("demo.zkproofport.app"), "domain");
    }

    function testPinnedOprfKeyHashAccepted() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        require(p[96] == TESTNET_OPRF_KEY_HASH, "fixture");
        require(drop.verifyClaim(ALICE, 0, hex"cafe", p), "preflight");
        _claim(drop, ALICE, p);
        require(drop.claimed(FAUCET_WALLET_1) && seed.balanceOf(ALICE) == CLAIM, "not paid");
    }

    function testOtherOprfKeyHashRejected() public {
        bytes32[3] memory wrong = [bytes32(0), bytes32(uint256(TESTNET_OPRF_KEY_HASH) ^ 1), DEMO_DOMAIN_FIELD];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
            p[96] = wrong[i];
            vm.expectRevert(SsiatDrop.WrongOprfKey.selector);
            _claim(drop, ALICE, p);
        }
        require(drop.totalClaims() == 0 && !drop.claimed(FAUCET_WALLET_1), "claimed under a foreign key");
    }

    function testOprfKeyHashAtFieldModulusRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[96] = bytes32(uint256(TESTNET_OPRF_KEY_HASH) + P);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputField.selector, 96));
        _claim(drop, ALICE, p);
    }

    function testFuzzOnlyThePinnedKeyHashPasses(bytes32 keyHash) public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[96] = keyHash;
        if (keyHash == TESTNET_OPRF_KEY_HASH) {
            require(drop.verifyClaim(ALICE, 0, hex"cafe", p), "pinned key refused");
        } else if (uint256(keyHash) >= P) {
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputField.selector, 96));
            drop.verifyClaim(ALICE, 0, hex"cafe", p);
        } else {
            vm.expectRevert(SsiatDrop.WrongOprfKey.selector);
            drop.verifyClaim(ALICE, 0, hex"cafe", p);
        }
    }

    function testOtherOprfDomainsRejected() public {
        bytes32[3] memory wrong = [
            bytes32(0),
            bytes32(uint256(keccak256("stg-demo.zkproofport.app")) % P),
            bytes32(uint256(keccak256("localhost")) % P)
        ];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
            p[97] = wrong[i];
            vm.expectRevert(SsiatDrop.WrongOprfDomain.selector);
            _claim(drop, ALICE, p);
        }
    }

    function testUnreducedOprfDomainRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[97] = keccak256("demo.zkproofport.app");
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputField.selector, 97));
        _claim(drop, ALICE, p);
    }

    function testDomainAndScopeSwappedRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        (p[97], p[98]) = (p[98], p[97]);
        vm.expectRevert(SsiatDrop.WrongOprfDomain.selector);
        _claim(drop, ALICE, p);
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
            p[98] = bytes32(uint256(wrong[i]) % P);
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
        bytes32[] memory third = _inputs(small, BOB, bytes32(uint256(keccak256("third")) % P));
        vm.expectRevert(SsiatDrop.DropExhausted.selector);
        small.verifyClaim(BOB, 0, hex"cafe", third);
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
        DojangVerifierDouble(VERIFIER_STANDARD).setMode(1);
        vm.expectRevert(SsiatDrop.InvalidProof.selector);
        _claim(drop, ALICE, p);
        require(!drop.claimed(FAUCET_WALLET_1) && seed.balanceOf(ALICE) == 0, "state changed");
    }

    function testVerifierRevertingRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        DojangVerifierDouble(VERIFIER_STANDARD).setMode(2);
        vm.expectRevert(SsiatDrop.InvalidProof.selector);
        _claim(drop, ALICE, p);
    }

    function testTamperedProofRejected() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        vm.expectRevert(SsiatDrop.InvalidProof.selector);
        drop.claim(ALICE, 0, hex"dead", p);
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
            drop.VERIFIER_STANDARD() == VERIFIER_STANDARD && drop.VERIFIER_ANDROID() == VERIFIER_ANDROID
                && drop.VERIFIER_ANDROID_FACTORY() == VERIFIER_ANDROID_FACTORY,
            "verifiers"
        );
        require(drop.PUBLIC_INPUT_COUNT() == 101 && drop.CHAIN_ID() == 91342, "constants");
        require(drop.ATTESTED_AT_MAX_AGE() == 900 && drop.ATTESTED_AT_MAX_FUTURE() == 300, "windows");
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
        address[3] memory verifiers = [VERIFIER_STANDARD, VERIFIER_ANDROID, VERIFIER_ANDROID_FACTORY];
        for (uint256 i; i < verifiers.length; ++i) {
            bytes memory code = verifiers[i].code;
            vm.etch(verifiers[i], hex"");
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.ContractNotDeployed.selector, verifiers[i]));
            new SsiatDrop(CLAIM, SUPPLY);
            vm.etch(verifiers[i], code);
        }
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
        // core's reduceOprfName of that scope: what the proof publishes.
        require(
            target.oprfName(target.claimScope()) == 0x05064f2ea48751d2ebd5d04383ec840dbd87199b8d2e2c8cab6b052f11bf12f1,
            "scope field"
        );
    }

    // ---------- conservation ----------

    function testFuzzClaimsConserveSupply(address recipient, bytes32 nullifier) public {
        if (recipient == address(0)) recipient = ALICE;
        nullifier = bytes32(uint256(nullifier) % P);
        _claim(drop, recipient, _inputs(drop, recipient, nullifier));
        require(drop.remaining() + seed.balanceOf(recipient) == SUPPLY || recipient == address(drop), "supply leaked");
        require(drop.claimed(nullifier) && drop.totalClaims() == 1, "claim not recorded");
    }

    // ---------- signer packages: one verifier each ----------

    function _verifiers() internal pure returns (address[3] memory) {
        return [VERIFIER_STANDARD, VERIFIER_ANDROID, VERIFIER_ANDROID_FACTORY];
    }

    function _nullifier(uint256 i) internal pure returns (bytes32) {
        return bytes32(uint256(keccak256(abi.encode("faucet wallet", i))) % P);
    }

    function testPublishesTheThreeVerifiers() public view {
        require(drop.SIGNER_STANDARD() == 0 && drop.SIGNER_ANDROID() == 1 && drop.SIGNER_ANDROID_FACTORY() == 2, "ids");
        for (uint8 v; v < 3; ++v) {
            require(drop.verifierFor(v) == _verifiers()[v], "verifierFor");
        }
    }

    // Only the selected package's verifier answers: the others are set to refuse, so a
    // claim passes exactly when the call went to the selected one.
    function testEachVariantRoutesToItsOwnVerifier() public {
        address[3] memory verifiers = _verifiers();
        for (uint8 v; v < 3; ++v) {
            for (uint256 j; j < 3; ++j) {
                DojangVerifierDouble(verifiers[j]).setMode(j == v ? 0 : 1);
            }
            bytes32[] memory p = _inputs(drop, ALICE, _nullifier(v));
            vm.expectCall(verifiers[v], abi.encodeCall(DojangVerifierDouble.verify, (hex"cafe", p)));
            drop.claim(ALICE, v, hex"cafe", p);
            require(drop.claimed(_nullifier(v)), "not claimed");
        }
        require(drop.totalClaims() == 3 && seed.balanceOf(ALICE) == 3 * CLAIM, "claims");
    }

    function testAProofIsRefusedOnAnotherPackagesVerifier() public {
        address[3] memory verifiers = _verifiers();
        for (uint8 v; v < 3; ++v) {
            for (uint256 j; j < 3; ++j) {
                DojangVerifierDouble(verifiers[j]).setMode(j == v ? 1 : 0);
            }
            bytes32[] memory p = _inputs(drop, ALICE, _nullifier(v));
            vm.expectRevert(SsiatDrop.InvalidProof.selector);
            drop.claim(ALICE, v, hex"cafe", p);
            require(!drop.claimed(_nullifier(v)), "nullifier burnt by a refused claim");
        }
        require(drop.totalClaims() == 0, "claims");
    }

    function testUnknownVariantRejectedByName() public {
        uint8[4] memory unknown = [uint8(3), 4, 128, 255];
        for (uint256 i; i < unknown.length; ++i) {
            bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.UnknownSignerVariant.selector, unknown[i]));
            drop.claim(ALICE, unknown[i], hex"cafe", p);
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.UnknownSignerVariant.selector, unknown[i]));
            drop.verifyClaim(ALICE, unknown[i], hex"cafe", p);
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.UnknownSignerVariant.selector, unknown[i]));
            drop.verifierFor(unknown[i]);
        }
        require(!drop.claimed(FAUCET_WALLET_1) && drop.totalClaims() == 0, "state moved");
    }

    function testUnknownVariantReportedBeforeLayout() public {
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.UnknownSignerVariant.selector, uint8(3)));
        drop.verifyClaim(ALICE, 3, hex"cafe", new bytes32[](4));
    }

    function testVariantOutsideUint8IsNotAccepted() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        bytes memory data = abi.encodeCall(SsiatDrop.claim, (ALICE, 0, hex"cafe", p));
        // Overwrite the variant word (second argument) with 256, which no uint8 can hold.
        assembly {
            mstore(add(data, add(32, add(4, 32))), 256)
        }
        (bool success,) = address(drop).call(data);
        require(!success, "variant 256 accepted");
        require(!drop.claimed(FAUCET_WALLET_1) && drop.totalClaims() == 0, "state moved");
    }

    function testFuzzOnlyKnownVariantsResolve(uint8 variant) public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        if (variant < 3) {
            require(drop.verifyClaim(ALICE, variant, hex"cafe", p), "known variant refused");
        } else {
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.UnknownSignerVariant.selector, variant));
            drop.verifyClaim(ALICE, variant, hex"cafe", p);
        }
    }

    // The nullifier is per faucet wallet and drop, whichever package made the proof.
    function testNullifierReplayRefusedAcrossVariants() public {
        drop.claim(ALICE, 0, hex"cafe", _inputs(drop, ALICE, FAUCET_WALLET_1));
        for (uint8 v; v < 3; ++v) {
            bytes32[] memory again = _inputs(drop, BOB, FAUCET_WALLET_1);
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AlreadyClaimed.selector, FAUCET_WALLET_1));
            drop.claim(BOB, v, hex"cafe", again);
        }
        require(drop.totalClaims() == 1 && seed.balanceOf(BOB) == 0, "paid twice");
    }

    // ---------- layout: 101 inputs ----------

    function testOneInputShortOrOverRejected() public {
        uint256[2] memory counts = [uint256(100), 102];
        bytes32[] memory full = _inputs(drop, ALICE, FAUCET_WALLET_1);
        for (uint256 i; i < counts.length; ++i) {
            bytes32[] memory p = new bytes32[](counts[i]);
            for (uint256 j; j < counts[i] && j < full.length; ++j) {
                p[j] = full[j];
            }
            vm.expectRevert(SsiatDrop.InvalidPublicInputCount.selector);
            _claim(drop, ALICE, p);
        }
    }

    // ---------- attested_at freshness ----------

    function _at(uint256 attestedAt) internal view returns (bytes32[] memory p) {
        p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        p[100] = bytes32(attestedAt);
    }

    function testAttestedAtExactlyMaxAgeAccepted() public {
        _claim(drop, ALICE, _at(NOW - 900));
        require(drop.claimed(FAUCET_WALLET_1), "not claimed");
    }

    function testAttestedAtOneSecondPastMaxAgeRejected() public {
        bytes32[] memory p = _at(NOW - 901);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtTooOld.selector, NOW - 901, NOW));
        _claim(drop, ALICE, p);
        require(!drop.claimed(FAUCET_WALLET_1) && drop.totalClaims() == 0, "stale proof burnt the nullifier");
    }

    function testAttestedAtExactlyMaxFutureAccepted() public {
        _claim(drop, ALICE, _at(NOW + 300));
        require(drop.claimed(FAUCET_WALLET_1), "not claimed");
    }

    function testAttestedAtOneSecondPastMaxFutureRejected() public {
        bytes32[] memory p = _at(NOW + 301);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtInFuture.selector, NOW + 301, NOW));
        _claim(drop, ALICE, p);
    }

    function testAttestedAtZeroRejected() public {
        bytes32[] memory p = _at(0);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtTooOld.selector, 0, NOW));
        drop.verifyClaim(ALICE, 0, hex"cafe", p);
    }

    function testAProofGoesStaleWhileWaiting() public {
        bytes32[] memory p = _inputs(drop, ALICE, FAUCET_WALLET_1);
        require(drop.verifyClaim(ALICE, 0, hex"cafe", p), "fresh proof refused");
        vm.warp(NOW + 900);
        require(drop.verifyClaim(ALICE, 0, hex"cafe", p), "proof at the edge refused");
        vm.warp(NOW + 901);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtTooOld.selector, NOW, NOW + 901));
        _claim(drop, ALICE, p);
    }

    function testAlreadyClaimedReportedBeforeStaleness() public {
        _claim(drop, ALICE, _inputs(drop, ALICE, FAUCET_WALLET_1));
        bytes32[] memory stale = _at(NOW - 901);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AlreadyClaimed.selector, FAUCET_WALLET_1));
        _claim(drop, ALICE, stale);
    }

    function testAttestedAtMaxUint64IsInTheFuture() public {
        bytes32[] memory p = _at(type(uint64).max);
        vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtInFuture.selector, uint256(type(uint64).max), NOW));
        drop.verifyClaim(ALICE, 0, hex"cafe", p);
    }

    function testAttestedAtAtOrAbove2To64Rejected() public {
        uint256[3] memory wrong = [uint256(1) << 64, (uint256(1) << 64) + NOW, P - 1];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _at(wrong[i]);
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtNotUint64.selector, wrong[i]));
            drop.verifyClaim(ALICE, 0, hex"cafe", p);
        }
    }

    function testAttestedAtAtOrAboveFieldModulusRejected() public {
        uint256[3] memory wrong = [P, P + NOW, type(uint256).max];
        for (uint256 i; i < wrong.length; ++i) {
            bytes32[] memory p = _at(wrong[i]);
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.InvalidPublicInputField.selector, 100));
            _claim(drop, ALICE, p);
        }
    }

    function testFuzzAttestedAtWindow(uint64 attestedAt) public {
        bytes32[] memory p = _at(attestedAt);
        if (uint256(attestedAt) + 900 < NOW) {
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtTooOld.selector, uint256(attestedAt), NOW));
            drop.verifyClaim(ALICE, 0, hex"cafe", p);
        } else if (uint256(attestedAt) > NOW + 300) {
            vm.expectRevert(abi.encodeWithSelector(SsiatDrop.AttestedAtInFuture.selector, uint256(attestedAt), NOW));
            drop.verifyClaim(ALICE, 0, hex"cafe", p);
        } else {
            require(drop.verifyClaim(ALICE, 0, hex"cafe", p), "in-window time refused");
        }
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
