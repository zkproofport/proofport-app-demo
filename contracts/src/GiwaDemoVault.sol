// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IGiwaEligibilityVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

interface IGiwaVaultAsset {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title GIWA Sepolia eligibility-gated demo vault
/// @notice Test-only ERC-20 custody: no yield, shares, admin withdrawals or ERC-4626 interface.
/// @dev Uses the deployed giwa_attestation v2 verifiers and their TEST issuer. This does not verify
///      production Upbit KYC. Revocation and expiry come from a device-signed statement inside the
///      proof: the attestation was neither revoked nor expired at the public `attested_at`, which
///      this vault requires to be recent against `block.timestamp`.
contract GiwaDemoVault {
    uint256 public constant CHAIN_ID = 91342;
    /// @notice One verifier per signer package. A proof verifies only on the verifier of the package
    ///         that made it; the relay result's `signerVariant` names that package.
    address public constant VERIFIER_STANDARD = 0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE;
    address public constant VERIFIER_ANDROID = 0x428074597be3D784535e40F9b1cDfe048AF57F03;
    address public constant VERIFIER_ANDROID_FACTORY = 0x465FAB030D82241BD95268704537A782B8109807;
    /// @notice `signerVariant` argument values for the relay's `standard`, `android` and `android_factory`.
    uint8 public constant SIGNER_STANDARD = 0;
    uint8 public constant SIGNER_ANDROID = 1;
    uint8 public constant SIGNER_ANDROID_FACTORY = 2;
    address public constant TEST_ATTESTER = 0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b;
    uint256 public constant PUBLIC_INPUT_COUNT = 133;
    /// @notice `attested_at` may be at most this many seconds behind `block.timestamp`.
    uint256 public constant ATTESTED_AT_MAX_AGE = 900;
    /// @notice `attested_at` may be at most this many seconds ahead of `block.timestamp`.
    uint256 public constant ATTESTED_AT_MAX_FUTURE = 300;
    /// @notice The OPRF key hash a testnet proof must carry: the OPRF test network's key,
    ///         as the ZKProofport core package pins it (getPinnedOprfKeyHash('staging', 'giwa_attestation')).
    /// @dev The circuit accepts an OPRF answer from any self-consistent key, so a proof under another
    ///      key hash carries a nullifier whoever holds that key chose.
    bytes32 public constant OPRF_KEY_HASH = 0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1;
    /// @notice Pass this exact string as the request's `oprfDomain`.
    string public constant OPRF_DOMAIN = "demo.zkproofport.app";
    /// @dev BN254 scalar field: the OPRF fields are elements of it, and a scope or domain string is
    ///      published as keccak256(UTF-8) reduced modulo it.
    uint256 public constant FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 private constant BYTE_FIELDS = 128;
    uint256 private constant OPRF_KEY_HASH_INDEX = 128;
    uint256 private constant OPRF_DOMAIN_INDEX = 129;
    uint256 private constant SCOPE_INDEX = 130;
    uint256 private constant ATTESTED_AT_INDEX = 132;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant DEPOSIT_TYPEHASH =
        keccak256("Deposit(address account,address asset,uint256 amount,uint256 nonce)");

    IGiwaVaultAsset public immutable asset;
    bytes32 public immutable trustedSignerRoot;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public nonces;
    uint256 public totalDeposits;
    uint256 private _lock = 1;

    error WrongChain();
    error ContractNotDeployed(address target);
    error ZeroAddress();
    error ZeroAmount();
    error ProofRequired();
    error InvalidPublicInputCount();
    error InvalidPublicInputByte(uint256 index);
    error InvalidPublicInputField(uint256 index);
    error IdentityProofNotAllowed();
    error WrongDepositDomain();
    error WrongDepositAction();
    error UntrustedIssuer();
    error WrongDepositScope();
    error WrongOprfKey();
    error WrongOprfDomain();
    error UnknownSignerVariant(uint8 signerVariant);
    error AttestedAtNotUint64(uint256 value);
    error AttestedAtTooOld(uint256 attestedAt, uint256 blockTimestamp);
    error AttestedAtInFuture(uint256 attestedAt, uint256 blockTimestamp);
    error InvalidProof();
    error InsufficientBalance();
    error TokenTransferFailed();
    error UnsupportedToken();
    error Reentrancy();

    event Deposited(address indexed account, uint256 amount, uint256 nonce);
    event Withdrawn(address indexed account, uint256 amount);

    constructor(address assetAddress) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (assetAddress == address(0)) revert ZeroAddress();
        if (assetAddress.code.length == 0) revert ContractNotDeployed(assetAddress);
        if (VERIFIER_STANDARD.code.length == 0) revert ContractNotDeployed(VERIFIER_STANDARD);
        if (VERIFIER_ANDROID.code.length == 0) revert ContractNotDeployed(VERIFIER_ANDROID);
        if (VERIFIER_ANDROID_FACTORY.code.length == 0) revert ContractNotDeployed(VERIFIER_ANDROID_FACTORY);
        asset = IGiwaVaultAsset(assetAddress);
        // Matches GIWA_SIGNER_ROOT in lib/giwa-membership.ts (one-leaf Merkle tree).
        trustedSignerRoot = keccak256(abi.encodePacked(TEST_ATTESTER));
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice EIP-712 domain for Gotgan version 2 on this chain and vault.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("Gotgan"), keccak256("2"), block.chainid, address(this)));
    }

    /// @notice EIP-712 hashStruct of Deposit(account, asset, amount, current nonce).
    /// @dev This is the action hash, not the complete EIP-712 signing digest.
    function depositActionHash(address account, uint256 amount) public view returns (bytes32) {
        return keccak256(abi.encode(DEPOSIT_TYPEHASH, account, address(asset), amount, nonces[account]));
    }

    /// @notice Pass this exact string as the mobile giwa_attestation request's `scope`.
    /// @dev Binds the proof to this chain, vault, token, caller, amount and next deposit.
    ///      No KYC address is needed. A successful deposit consumes the current nonce.
    function depositScope(address account, uint256 amount) public view returns (string memory) {
        bytes32 action =
            keccak256(abi.encode(block.chainid, address(this), address(asset), account, amount, nonces[account]));
        bytes memory encoded = new bytes(64);
        bytes16 alphabet = "0123456789abcdef";
        for (uint256 i; i < 32; ++i) {
            encoded[2 * i] = alphabet[uint8(action[i]) >> 4];
            encoded[2 * i + 1] = alphabet[uint8(action[i]) & 15];
        }
        return string.concat("giwa-vault:v1:", string(encoded));
    }

    /// @notice A scope or domain string as the proof publishes it: keccak256(UTF-8) mod the field.
    function oprfName(string memory name) public pure returns (bytes32) {
        return bytes32(uint256(keccak256(bytes(name))) % FIELD_MODULUS);
    }

    /// @notice The verifier for a signer package: 0 standard, 1 android, 2 android_factory.
    /// @dev Any other value reverts; it never resolves to another package's verifier.
    function verifierFor(uint8 signerVariant) public pure returns (address) {
        if (signerVariant == SIGNER_STANDARD) return VERIFIER_STANDARD;
        if (signerVariant == SIGNER_ANDROID) return VERIFIER_ANDROID;
        if (signerVariant == SIGNER_ANDROID_FACTORY) return VERIFIER_ANDROID_FACTORY;
        revert UnknownSignerVariant(signerVariant);
    }

    /// @notice Read-only preflight. Reverts on a policy mismatch or an invalid proof.
    /// @dev `publicInputs` is 133 bytes32 values. The first 128 hold ONE BYTE EACH of four hashes:
    ///      signal[0..31], EIP-712 domain[32..63], action[64..95], issuer root[96..127].
    ///      Then whole field elements: OPRF key hash[128], OPRF domain[129], scope[130],
    ///      nullifier[131], and attested_at[132] (unix seconds, u64). Identity-only proofs cannot
    ///      authorize deposits. `signerVariant` selects the verifier of the package that made the proof.
    function verifyEligibility(
        address account,
        uint256 amount,
        uint8 signerVariant,
        bytes calldata proof,
        bytes32[] calldata publicInputs
    ) public view returns (bool) {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (proof.length == 0) revert ProofRequired();
        address verifier = verifierFor(signerVariant);
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert InvalidPublicInputCount();

        bytes32[4] memory fields;
        for (uint256 i; i < BYTE_FIELDS; ++i) {
            uint256 value = uint256(publicInputs[i]);
            if (value > 255) revert InvalidPublicInputByte(i);
            fields[i / 32] = bytes32((uint256(fields[i / 32]) << 8) | value);
        }
        // A value at or above the modulus aliases a smaller one inside the verifier.
        for (uint256 i = BYTE_FIELDS; i < PUBLIC_INPUT_COUNT; ++i) {
            if (uint256(publicInputs[i]) >= FIELD_MODULUS) revert InvalidPublicInputField(i);
        }
        if (fields[0] != bytes32(0)) revert IdentityProofNotAllowed();
        if (fields[1] != domainSeparator()) revert WrongDepositDomain();
        if (fields[2] != depositActionHash(account, amount)) revert WrongDepositAction();
        if (fields[3] != trustedSignerRoot) revert UntrustedIssuer();
        if (publicInputs[OPRF_KEY_HASH_INDEX] != OPRF_KEY_HASH) revert WrongOprfKey();
        if (publicInputs[OPRF_DOMAIN_INDEX] != oprfName(OPRF_DOMAIN)) revert WrongOprfDomain();
        if (publicInputs[SCOPE_INDEX] != oprfName(depositScope(account, amount))) revert WrongDepositScope();
        _checkAttestedAt(publicInputs[ATTESTED_AT_INDEX]);

        // The pinned Honk verifier can REVERT for invalid proofs, not just return false.
        try IGiwaEligibilityVerifier(verifier).verify(proof, publicInputs) returns (bool valid) {
            if (!valid) revert InvalidProof();
        } catch {
            revert InvalidProof();
        }
        return true;
    }

    /// @notice Approve this vault to spend `amount` first, then deposit from the operational wallet.
    /// @dev Every deposit needs its own proof. The KYC wallet does not send this transaction.
    function deposit(uint256 amount, uint8 signerVariant, bytes calldata proof, bytes32[] calldata publicInputs)
        external
        nonReentrant
    {
        verifyEligibility(msg.sender, amount, signerVariant, proof, publicInputs);
        uint256 nonce = nonces[msg.sender];
        nonces[msg.sender] = nonce + 1;
        balanceOf[msg.sender] += amount;
        totalDeposits += amount;

        uint256 beforeBalance = asset.balanceOf(address(this));
        _transfer(abi.encodeCall(IGiwaVaultAsset.transferFrom, (msg.sender, address(this), amount)));
        if (asset.balanceOf(address(this)) != beforeBalance + amount) revert UnsupportedToken();
        emit Deposited(msg.sender, amount, nonce);
    }

    /// @notice Withdraw your own deposit to the same operational wallet; no new proof needed.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        totalDeposits -= amount;
        _transfer(abi.encodeCall(IGiwaVaultAsset.transfer, (msg.sender, amount)));
        emit Withdrawn(msg.sender, amount);
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

    function _transfer(bytes memory callData) private {
        (bool success, bytes memory returned) = address(asset).call(callData);
        if (!success) revert TokenTransferFailed();
        if (returned.length != 0) {
            if (returned.length != 32 || !abi.decode(returned, (bool))) revert TokenTransferFailed();
        }
    }
}
