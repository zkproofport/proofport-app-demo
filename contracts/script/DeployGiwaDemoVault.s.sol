// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GiwaDemoVault} from "../src/GiwaDemoVault.sol";

interface DeploymentVm {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy a separate Gotgan v2 vault; never migrates or calls the legacy vault.
/// @dev Prerequisites: Foundry 1.4.3, GIWA Sepolia RPC, GIWA_VAULT_ASSET set explicitly, and the
///      deployer key exported as PRIVATE_KEY by the shell (`set -a; source <env file>; set +a`).
///      The key is read with vm.envUint so it never appears on a command line, where `ps` would show it.
///      `forge script` simulates by default. Only add --broadcast for an authorized deployment.
contract DeployGiwaDemoVault {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event VaultDeployed(address indexed vault, address indexed asset, address verifier, bytes32 domainSeparator);

    function run() external returns (GiwaDemoVault vault) {
        address asset = vm.envAddress("GIWA_VAULT_ASSET");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        vault = new GiwaDemoVault(asset);
        vm.stopBroadcast();

        require(address(vault).code.length != 0, "Vault deployment has no bytecode");
        require(address(vault.asset()) == asset, "Vault asset mismatch");
        require(vault.VERIFIER() == 0xF6Edb9d6114B2546B6E559997fdDE08CAeEA83b3, "Vault verifier mismatch");
        require(vault.PUBLIC_INPUT_COUNT() == 192, "Vault public input layout mismatch");
        require(vault.totalDeposits() == 0, "New vault has nonzero deposits");
        emit VaultDeployed(address(vault), asset, vault.VERIFIER(), vault.domainSeparator());
    }
}
