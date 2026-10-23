// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SsiatSeed} from "./SsiatSeed.sol";

interface IDojangPlaygroundVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title Ssiat: a seed drop for GIWA Sepolia Playground faucet participants (testnet demo)
/// @notice Pays a fixed amount of SEED, a valueless test token, once per Playground faucet wallet.
///         Ssiat is a fictional brand. This is not a GIWA, Upbit or Dojang airdrop.
/// @dev Uses the deployed `dojang_playground` verifier. What that proof establishes:
///      - the faucet wallet signed this drop's EIP-712 `Claim(recipient)` action, and
///      - the SAME key signed a GIWA Sepolia `payAndIssueEAS()` transaction to the Playground faucet
///        `0x63CCe2b569A7bC35895ee24306c1512fefc06121`.
///      What it does NOT establish: that the faucet transaction was ever included or succeeded.
///      The official app checks inclusion before proving, but a hand-built prover can sign an
///      unbroadcast faucet call from a fresh key. One claim per faucet wallet is therefore
///      one claim per KEY, and keys are free: this drop is sybil-able and must hold nothing of value.
///      The faucet wallet itself never appears on chain; only its per-drop nullifier does.
contract SsiatDrop {
    uint256 public constant CHAIN_ID = 91342;
    address public constant VERIFIER = 0xAD6C9bFA60F3ee618dee9DC2027a69C57f2aD816;
    uint256 public constant PUBLIC_INPUT_COUNT = 160;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CLAIM_TYPEHASH = keccak256("Claim(address recipient)");

    SsiatSeed public immutable token;
    uint256 public immutable CLAIM_AMOUNT;
    mapping(bytes32 => bool) public claimed;
    uint256 public totalClaims;
    uint256 private _lock = 1;

    error WrongChain();
    error ContractNotDeployed(address target);
    error ZeroAmount();
    error SupplyBelowClaimAmount();
    error ZeroAddress();
    error ProofRequired();
    error InvalidPublicInputCount();
    error InvalidPublicInputByte(uint256 index);
    error IdentityProofNotAllowed();
    error WrongClaimDomain();
    error WrongClaimAction();
    error WrongClaimScope();
    error AlreadyClaimed(bytes32 nullifier);
    error DropExhausted();
    error InvalidProof();
    error TokenTransferFailed();
    error Reentrancy();

    event DropCreated(address indexed token, uint256 supply, uint256 claimAmount);
    event Claimed(bytes32 indexed nullifier, address indexed recipient, uint256 amount);

    /// @param claimAmount SEED base units paid per claim (18 decimals).
    /// @param supply Total SEED minted straight into this contract; nothing is minted later.
    constructor(uint256 claimAmount, uint256 supply) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (VERIFIER.code.length == 0) revert ContractNotDeployed(VERIFIER);
        if (claimAmount == 0) revert ZeroAmount();
        if (supply < claimAmount) revert SupplyBelowClaimAmount();
        CLAIM_AMOUNT = claimAmount;
        // Deployed here so the entire supply lands in the drop in the same transaction.
        token = new SsiatSeed(address(this), supply);
        emit DropCreated(address(token), supply, claimAmount);
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice EIP-712 domain: name "Ssiat", version "1", this chain, this contract.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Ssiat"), keccak256("1"), block.chainid, address(this)));
    }

    /// @notice EIP-712 hashStruct of `Claim(recipient)`; the action hash, not the full signing digest.
    /// @dev Binding the recipient stops a copied proof from being redirected to another address.
    function claimActionHash(address recipient) public view returns (bytes32) {
        return keccak256(abi.encode(CLAIM_TYPEHASH, recipient));
    }

    /// @notice Pass this exact string as the `dojang_playground` request's `scope`; the app hashes it once.
    /// @dev Fixed per chain and contract and independent of the recipient: the nullifier is per
    ///      (faucet wallet, scope), so a recipient-dependent scope would allow one claim per recipient.
    function claimScope() public view returns (string memory) {
        bytes32 seed = keccak256(abi.encode(block.chainid, address(this)));
        bytes memory encoded = new bytes(64);
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i; i < 32; ++i) {
            encoded[2 * i] = alphabet[uint8(seed[i]) >> 4];
            encoded[2 * i + 1] = alphabet[uint8(seed[i]) & 15];
        }
        return string.concat("ssiat-drop:v1:", string(encoded));
    }

    /// @notice SEED still available to claim.
    function remaining() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Read-only preflight: reverts with the reason a `claim` would fail, else returns true.
    /// @dev `publicInputs` is 160 bytes32 fields holding ONE BYTE EACH, not five hashes.
    ///      Layout: signal[0..31], domain[32..63], action[64..95], scope[96..127], nullifier[128..159].
    function verifyClaim(address recipient, bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        _check(recipient, proof, publicInputs);
        return true;
    }

    /// @notice Pays CLAIM_AMOUNT SEED to `recipient`. Anyone may submit; the proof decides who receives.
    function claim(address recipient, bytes calldata proof, bytes32[] calldata publicInputs) external nonReentrant {
        bytes32 nullifier = _check(recipient, proof, publicInputs);
        claimed[nullifier] = true;
        totalClaims += 1;
        (bool success, bytes memory returned) =
            address(token).call(abi.encodeCall(SsiatSeed.transfer, (recipient, CLAIM_AMOUNT)));
        if (!success || (returned.length != 0 && (returned.length != 32 || !abi.decode(returned, (bool))))) {
            revert TokenTransferFailed();
        }
        emit Claimed(nullifier, recipient, CLAIM_AMOUNT);
    }

    function _check(address recipient, bytes calldata proof, bytes32[] calldata publicInputs)
        private
        view
        returns (bytes32 nullifier)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (proof.length == 0) revert ProofRequired();
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert InvalidPublicInputCount();

        bytes32[5] memory fields;
        for (uint256 i; i < PUBLIC_INPUT_COUNT; ++i) {
            uint256 value = uint256(publicInputs[i]);
            if (value > 255) revert InvalidPublicInputByte(i);
            fields[i / 32] = bytes32((uint256(fields[i / 32]) << 8) | value);
        }
        if (fields[0] != bytes32(0)) revert IdentityProofNotAllowed();
        if (fields[1] != domainSeparator()) revert WrongClaimDomain();
        if (fields[2] != claimActionHash(recipient)) revert WrongClaimAction();
        if (fields[3] != keccak256(bytes(claimScope()))) revert WrongClaimScope();
        nullifier = fields[4];
        if (claimed[nullifier]) revert AlreadyClaimed(nullifier);
        if (token.balanceOf(address(this)) < CLAIM_AMOUNT) revert DropExhausted();

        // The pinned Honk verifier can REVERT on an invalid proof, not only return false.
        try IDojangPlaygroundVerifier(VERIFIER).verify(proof, publicInputs) returns (bool valid) {
            if (!valid) revert InvalidProof();
        } catch {
            revert InvalidProof();
        }
    }
}
