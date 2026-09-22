// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GiwaDemoVault} from "../src/GiwaDemoVault.sol";

interface DeploymentVm {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploy a separate Gotgan v2 vault; never migrates or calls the legacy vault.
/// @dev Prerequisites: Foundry 1.4.3, GIWA Sepolia RPC, GIWA_VAULT_ASSET set explicitly.
///      `forge script` simulates by default. Only add --broadcast for an authorized deployment.
///      Select the signing wallet through Foundry's --account option; do not put keys in this file.
contract DeployGiwaDemoVault {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event VaultDeployed(address indexed vault, address indexed asset, address verifier, bytes32 domainSeparator);

    function run() external returns (GiwaDemoVault vault) {
        address asset = vm.envAddress("GIWA_VAULT_ASSET");
        vm.startBroadcast();
        vault = new GiwaDemoVault(asset);
        vm.stopBroadcast();

        require(address(vault).code.length != 0, "Vault deployment has no bytecode");
        require(address(vault.asset()) == asset, "Vault asset mismatch");
        require(vault.VERIFIER() == 0x5Da234546874304F8c51BBEed00fC632938211c1, "Vault verifier mismatch");
        require(vault.PUBLIC_INPUT_COUNT() == 192, "Vault public input layout mismatch");
        require(vault.totalDeposits() == 0, "New vault has nonzero deposits");
        emit VaultDeployed(address(vault), asset, vault.VERIFIER(), vault.domainSeparator());
    }
}
