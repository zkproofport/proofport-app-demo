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

    event VaultDeployed(address indexed vault, address indexed asset, bytes32 domainSeparator);

    function run() external returns (GiwaDemoVault vault) {
        address asset = vm.envAddress("GIWA_VAULT_ASSET");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        vault = new GiwaDemoVault(asset);
        vm.stopBroadcast();

        require(address(vault).code.length != 0, "Vault deployment has no bytecode");
        require(address(vault.asset()) == asset, "Vault asset mismatch");
        require(
            vault.VERIFIER_STANDARD() == 0x55E7b9d9F2E9ac0080B668514eE01F15b686bfCE, "Vault standard verifier mismatch"
        );
        require(
            vault.VERIFIER_ANDROID() == 0x428074597be3D784535e40F9b1cDfe048AF57F03, "Vault android verifier mismatch"
        );
        require(
            vault.VERIFIER_ANDROID_FACTORY() == 0x465FAB030D82241BD95268704537A782B8109807,
            "Vault android factory verifier mismatch"
        );
        require(vault.PUBLIC_INPUT_COUNT() == 133, "Vault public input layout mismatch");
        require(vault.ATTESTED_AT_MAX_AGE() == 900 && vault.ATTESTED_AT_MAX_FUTURE() == 300, "Vault freshness mismatch");
        require(
            vault.OPRF_KEY_HASH() == 0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1,
            "Vault OPRF key hash mismatch"
        );
        require(
            keccak256(bytes(vault.OPRF_DOMAIN())) == keccak256("demo.zkproofport.app"), "Vault OPRF domain mismatch"
        );
        require(vault.totalDeposits() == 0, "New vault has nonzero deposits");
        emit VaultDeployed(address(vault), asset, vault.domainSeparator());
    }
}
