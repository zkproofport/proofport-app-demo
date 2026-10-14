// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SsiatDrop} from "../src/SsiatDrop.sol";
import {SsiatSeed} from "../src/SsiatSeed.sol";

interface DeploymentVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploy the Ssiat seed drop on GIWA Sepolia. The drop deploys its own SEED token in its
///         constructor, so the whole supply lands in the drop in one transaction.
/// @dev Prerequisites: Foundry 1.4.3 and the GIWA Sepolia RPC. Takes no environment variables.
///      `forge script` simulates by default. Only add --broadcast for an authorized deployment,
///      and select the signing wallet with Foundry's --account option; never put a key in this file.
contract DeploySsiatDrop {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    /// 100 SEED per faucet wallet; 1,000,000 SEED in the pool, i.e. 10,000 claims.
    uint256 public constant CLAIM_AMOUNT = 100 ether;
    uint256 public constant SUPPLY = 1_000_000 ether;
    address public constant VERIFIER = 0x2d01C2fE3445B7DDE60118f956BB14E84Fd64724;

    event SsiatDropDeployed(address indexed drop, address indexed token, string scope, bytes32 domainSeparator);

    function run() external returns (SsiatDrop drop) {
        vm.startBroadcast();
        drop = new SsiatDrop(CLAIM_AMOUNT, SUPPLY);
        vm.stopBroadcast();

        SsiatSeed token = drop.token();
        require(address(drop).code.length != 0, "Drop deployment has no bytecode");
        require(address(token).code.length != 0, "Token deployment has no bytecode");
        require(drop.VERIFIER() == VERIFIER, "Drop verifier mismatch");
        require(drop.PUBLIC_INPUT_COUNT() == 160, "Drop public input layout mismatch");
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
