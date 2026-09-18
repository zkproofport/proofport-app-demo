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
/// @dev Uses the deployed giwa_attestation PoC verifier and its TEST issuer.
///      This does not verify production Upbit KYC, live EAS status or revocation.
contract GiwaDemoVault {
    uint256 public constant CHAIN_ID = 91342;
    address public constant VERIFIER = 0xEb9eb5452790Cfe549fF83CEB3Dbe1C432231492;
    address public constant TEST_ATTESTER = 0xEE099845CDfF93e73aDcBcB36A9B93578bcCed4b;
    uint256 public constant PUBLIC_INPUT_COUNT = 128;

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
    error UntrustedIssuer();
    error WrongDepositScope();
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
        if (VERIFIER.code.length == 0) revert ContractNotDeployed(VERIFIER);
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

    /// @notice Read-only preflight. Reverts on a policy mismatch or an invalid proof.
    /// @dev `publicInputs` is 128 bytes32 fields containing ONE BYTE EACH, not four hashes.
    ///      Layout: signal[0..31], issuer root[32..63], scope[64..95], nullifier[96..127].
    function verifyEligibility(address account, uint256 amount, bytes calldata proof, bytes32[] calldata publicInputs)
        public
        view
        returns (bool)
    {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (proof.length == 0) revert ProofRequired();
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert InvalidPublicInputCount();

        bytes32[4] memory fields;
        for (uint256 i; i < PUBLIC_INPUT_COUNT; ++i) {
            uint256 value = uint256(publicInputs[i]);
            if (value > 255) revert InvalidPublicInputByte(i);
            fields[i / 32] = bytes32((uint256(fields[i / 32]) << 8) | value);
        }
        if (fields[1] != trustedSignerRoot) revert UntrustedIssuer();
        if (fields[2] != keccak256(bytes(depositScope(account, amount)))) revert WrongDepositScope();

        // The pinned Honk verifier can REVERT for invalid proofs, not just return false.
        try IGiwaEligibilityVerifier(VERIFIER).verify(proof, publicInputs) returns (bool valid) {
            if (!valid) revert InvalidProof();
        } catch {
            revert InvalidProof();
        }
        return true;
    }

    /// @notice Approve this vault to spend `amount` first, then deposit from the operational wallet.
    /// @dev Every deposit needs its own proof. The KYC wallet does not send this transaction.
    function deposit(uint256 amount, bytes calldata proof, bytes32[] calldata publicInputs) external nonReentrant {
        verifyEligibility(msg.sender, amount, proof, publicInputs);
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

    function _transfer(bytes memory callData) private {
        (bool success, bytes memory returned) = address(asset).call(callData);
        if (!success) revert TokenTransferFailed();
        if (returned.length != 0) {
            if (returned.length != 32 || !abi.decode(returned, (bool))) revert TokenTransferFailed();
        }
    }
}
