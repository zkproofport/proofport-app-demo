// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SsiatSeed} from "./SsiatSeed.sol";

interface IDojangPlaygroundVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @title Ssiat: a seed drop for GIWA Sepolia Playground faucet participants (testnet demo)
/// @notice Pays a fixed amount of SEED, a valueless test token, once per Playground faucet wallet.
///         Ssiat is a fictional brand. This is not a GIWA, Upbit or Dojang airdrop.
/// @dev Uses the deployed `dojang_playground` v2 verifiers. What that proof establishes:
///      - the faucet wallet signed this drop's EIP-712 `Claim(recipient)` action,
///      - the SAME key signed a GIWA Sepolia `payAndIssueEAS()` transaction to the Playground faucet
///        `0x63CCe2b569A7bC35895ee24306c1512fefc06121`, and
///      - a device-signed statement says that wallet's attestation was neither revoked nor expired
///        at the public `attested_at`, which this drop requires to be recent against `block.timestamp`.
///      What it does NOT establish: that the faucet transaction was ever included or succeeded.
///      The official app checks inclusion before proving, but a hand-built prover can sign an
///      unbroadcast faucet call from a fresh key. One claim per faucet wallet is therefore
///      one claim per KEY, and keys are free: this drop is sybil-able and must hold nothing of value.
///      The faucet wallet itself never appears on chain; only its per-drop nullifier does.
contract SsiatDrop {
    uint256 public constant CHAIN_ID = 91342;
    /// @notice One verifier per signer package. A proof verifies only on the verifier of the package
    ///         that made it; the relay result's `signerVariant` names that package.
    address public constant VERIFIER_STANDARD = 0xC1c42ade7C31aFDf99FbaEDF97dA5b07fCCba724;
    address public constant VERIFIER_ANDROID = 0x7fc2059a73cEF2b572C8deEe911c72963dCB4A8a;
    address public constant VERIFIER_ANDROID_FACTORY = 0x0b3Af3DFc67dC65E0145c37ee00230139d579F64;
    /// @notice `signerVariant` argument values for the relay's `standard`, `android` and `android_factory`.
    uint8 public constant SIGNER_STANDARD = 0;
    uint8 public constant SIGNER_ANDROID = 1;
    uint8 public constant SIGNER_ANDROID_FACTORY = 2;
    uint256 public constant PUBLIC_INPUT_COUNT = 101;
    /// @notice `attested_at` may be at most this many seconds behind `block.timestamp`.
    uint256 public constant ATTESTED_AT_MAX_AGE = 900;
    /// @notice `attested_at` may be at most this many seconds ahead of `block.timestamp`.
    uint256 public constant ATTESTED_AT_MAX_FUTURE = 300;
    /// @notice The OPRF key hash a testnet proof must carry: the OPRF test network's key,
    ///         as the ZKProofport core package pins it (getPinnedOprfKeyHash('staging', 'dojang_playground')).
    /// @dev The circuit accepts an OPRF answer from any self-consistent key. Under a key someone else
    ///      holds, the nullifier is whatever they choose, so one faucet wallet could claim many times.
    bytes32 public constant OPRF_KEY_HASH = 0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1;
    /// @notice Pass this exact string as the request's `oprfDomain`. Fixed, because the nullifier is
    ///         keyed by it: a second domain would give the same faucet wallet a second claim.
    string public constant OPRF_DOMAIN = "demo.zkproofport.app";
    /// @dev BN254 scalar field: the OPRF fields are elements of it, and a scope or domain string is
    ///      published as keccak256(UTF-8) reduced modulo it.
    uint256 public constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 private constant BYTE_FIELDS = 96;
    uint256 private constant OPRF_KEY_HASH_INDEX = 96;
    uint256 private constant OPRF_DOMAIN_INDEX = 97;
    uint256 private constant SCOPE_INDEX = 98;
    uint256 private constant NULLIFIER_INDEX = 99;
    uint256 private constant ATTESTED_AT_INDEX = 100;
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
    error InvalidPublicInputField(uint256 index);
    error IdentityProofNotAllowed();
    error WrongClaimDomain();
    error WrongClaimAction();
    error WrongClaimScope();
    error WrongOprfKey();
    error WrongOprfDomain();
    error AlreadyClaimed(bytes32 nullifier);
    error DropExhausted();
    error UnknownSignerVariant(uint8 signerVariant);
    error AttestedAtNotUint64(uint256 value);
    error AttestedAtTooOld(uint256 attestedAt, uint256 blockTimestamp);
    error AttestedAtInFuture(uint256 attestedAt, uint256 blockTimestamp);
    error InvalidProof();
    error TokenTransferFailed();
    error Reentrancy();

    event DropCreated(address indexed token, uint256 supply, uint256 claimAmount);
    event Claimed(bytes32 indexed nullifier, address indexed recipient, uint256 amount);

    /// @param claimAmount SEED base units paid per claim (18 decimals).
    /// @param supply Total SEED minted straight into this contract; nothing is minted later.
    constructor(uint256 claimAmount, uint256 supply) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (VERIFIER_STANDARD.code.length == 0) revert ContractNotDeployed(VERIFIER_STANDARD);
        if (VERIFIER_ANDROID.code.length == 0) revert ContractNotDeployed(VERIFIER_ANDROID);
        if (VERIFIER_ANDROID_FACTORY.code.length == 0) revert ContractNotDeployed(VERIFIER_ANDROID_FACTORY);
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

    /// @notice A scope or domain string as the proof publishes it: keccak256(UTF-8) mod the field.
    function oprfName(string memory name) public pure returns (bytes32) {
        return bytes32(uint256(keccak256(bytes(name))) % FIELD_MODULUS);
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

    /// @notice The verifier for a signer package: 0 standard, 1 android, 2 android_factory.
    /// @dev Any other value reverts; it never resolves to another package's verifier.
    function verifierFor(uint8 signerVariant) public pure returns (address) {
        if (signerVariant == SIGNER_STANDARD) return VERIFIER_STANDARD;
        if (signerVariant == SIGNER_ANDROID) return VERIFIER_ANDROID;
        if (signerVariant == SIGNER_ANDROID_FACTORY) return VERIFIER_ANDROID_FACTORY;
        revert UnknownSignerVariant(signerVariant);
    }

    /// @notice Read-only preflight: reverts with the reason a `claim` would fail, else returns true.
    /// @dev `publicInputs` is 101 bytes32 values. The first 96 hold ONE BYTE EACH of three hashes:
    ///      signal[0..31], EIP-712 domain[32..63], action[64..95]. Then whole field elements:
    ///      OPRF key hash[96], OPRF domain[97], scope[98], nullifier[99], and attested_at[100]
    ///      (unix seconds, u64). `signerVariant` selects the verifier of the package that made the proof.
    function verifyClaim(address recipient, uint8 signerVariant, bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        _check(recipient, signerVariant, proof, publicInputs);
        return true;
    }

    /// @notice Pays CLAIM_AMOUNT SEED to `recipient`. Anyone may submit; the proof decides who receives.
    function claim(address recipient, uint8 signerVariant, bytes calldata proof, bytes32[] calldata publicInputs)
        external
        nonReentrant
    {
        bytes32 nullifier = _check(recipient, signerVariant, proof, publicInputs);
        claimed[nullifier] = true;
        totalClaims += 1;
        (bool success, bytes memory returned) =
            address(token).call(abi.encodeCall(SsiatSeed.transfer, (recipient, CLAIM_AMOUNT)));
        if (!success || (returned.length != 0 && (returned.length != 32 || !abi.decode(returned, (bool))))) {
            revert TokenTransferFailed();
        }
        emit Claimed(nullifier, recipient, CLAIM_AMOUNT);
    }

    function _check(address recipient, uint8 signerVariant, bytes calldata proof, bytes32[] calldata publicInputs)
        private
        view
        returns (bytes32 nullifier)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (proof.length == 0) revert ProofRequired();
        address verifier = verifierFor(signerVariant);
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert InvalidPublicInputCount();

        bytes32[3] memory fields;
        for (uint256 i; i < BYTE_FIELDS; ++i) {
            uint256 value = uint256(publicInputs[i]);
            if (value > 255) revert InvalidPublicInputByte(i);
            fields[i / 32] = bytes32((uint256(fields[i / 32]) << 8) | value);
        }
        // A value at or above the modulus aliases a smaller one inside the verifier, which would
        // give one nullifier a second spelling and so a second claim.
        for (uint256 i = BYTE_FIELDS; i < PUBLIC_INPUT_COUNT; ++i) {
            if (uint256(publicInputs[i]) >= FIELD_MODULUS) revert InvalidPublicInputField(i);
        }
        if (fields[0] != bytes32(0)) revert IdentityProofNotAllowed();
        if (fields[1] != domainSeparator()) revert WrongClaimDomain();
        if (fields[2] != claimActionHash(recipient)) revert WrongClaimAction();
        if (publicInputs[OPRF_KEY_HASH_INDEX] != OPRF_KEY_HASH) revert WrongOprfKey();
        if (publicInputs[OPRF_DOMAIN_INDEX] != oprfName(OPRF_DOMAIN)) revert WrongOprfDomain();
        if (publicInputs[SCOPE_INDEX] != oprfName(claimScope())) revert WrongClaimScope();
        nullifier = publicInputs[NULLIFIER_INDEX];
        if (claimed[nullifier]) revert AlreadyClaimed(nullifier);
        if (token.balanceOf(address(this)) < CLAIM_AMOUNT) revert DropExhausted();
        // Checked after the outcomes a new proof cannot change (already claimed, pool empty).
        _checkAttestedAt(publicInputs[ATTESTED_AT_INDEX]);

        // The pinned Honk verifier can REVERT on an invalid proof, not only return false.
        try IDojangPlaygroundVerifier(verifier).verify(proof, publicInputs) returns (bool valid) {
            if (!valid) revert InvalidProof();
        } catch {
            revert InvalidProof();
        }
    }

    /// @dev The chain has no other clock for the device's status statement, so its time must be
    ///      close to the block's: at most ATTESTED_AT_MAX_AGE behind, ATTESTED_AT_MAX_FUTURE ahead.
    function _checkAttestedAt(bytes32 value) private view {
        uint256 attestedAt = uint256(value);
        if (attestedAt > type(uint64).max) revert AttestedAtNotUint64(attestedAt);
        if (attestedAt + ATTESTED_AT_MAX_AGE < block.timestamp) revert AttestedAtTooOld(attestedAt, block.timestamp);
        if (attestedAt > block.timestamp + ATTESTED_AT_MAX_FUTURE) {
            revert AttestedAtInFuture(attestedAt, block.timestamp);
        }
    }
}
