// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SsiatDrop} from "../src/SsiatDrop.sol";
import {SsiatSeed} from "../src/SsiatSeed.sol";

interface DeploymentVm {
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy the Ssiat seed drop on GIWA Sepolia. The drop deploys its own SEED token in its
///         constructor, so the whole supply lands in the drop in one transaction.
/// @dev Prerequisites: Foundry 1.4.3, the GIWA Sepolia RPC, and the deployer key exported as
///      PRIVATE_KEY by the shell (`set -a; source <env file>; set +a`). The key is read with
///      vm.envUint so it never appears on a command line, where `ps` would show it.
///      `forge script` simulates by default. Only add --broadcast for an authorized deployment.
contract DeploySsiatDrop {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// 100 SEED per faucet wallet; 1,000,000 SEED in the pool, i.e. 10,000 claims.
    uint256 public constant CLAIM_AMOUNT = 100 ether;
    uint256 public constant SUPPLY = 1_000_000 ether;
    address public constant VERIFIER = 0x400474E78a793289D091A5F556F78158956B5D01;
    bytes32 public constant OPRF_KEY_HASH = 0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1;

    event SsiatDropDeployed(address indexed drop, address indexed token, string scope, bytes32 domainSeparator);

    function run() external returns (SsiatDrop drop) {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        drop = new SsiatDrop(CLAIM_AMOUNT, SUPPLY);
        vm.stopBroadcast();

        SsiatSeed token = drop.token();
        require(address(drop).code.length != 0, "Drop deployment has no bytecode");
        require(address(token).code.length != 0, "Token deployment has no bytecode");
        require(drop.VERIFIER() == VERIFIER, "Drop verifier mismatch");
        require(drop.PUBLIC_INPUT_COUNT() == 100, "Drop public input layout mismatch");
        require(drop.OPRF_KEY_HASH() == OPRF_KEY_HASH, "Drop OPRF key hash mismatch");
        require(keccak256(bytes(drop.OPRF_DOMAIN())) == keccak256("demo.zkproofport.app"), "Drop OPRF domain mismatch");
        require(drop.CLAIM_AMOUNT() == CLAIM_AMOUNT, "Claim amount mismatch");
        require(token.totalSupply() == SUPPLY, "Token supply mismatch");
        require(token.balanceOf(address(drop)) == SUPPLY, "Supply did not land in the drop");
        require(drop.remaining() == SUPPLY && drop.totalClaims() == 0, "New drop is not full");
        require(
            keccak256(bytes(token.symbol())) == keccak256("SEED") && token.decimals() == 18, "Token metadata mismatch"
        );
        emit SsiatDropDeployed(address(drop), address(token), drop.claimScope(), drop.domainSeparator());
    }
}
