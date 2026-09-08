// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {VmSafe} from "forge-std/Vm.sol";
import {DeployV1ArbitrumStaged, V1BootstrapContext} from "./DeployV1ArbitrumStaged.s.sol";
import {V1DeploymentPlan} from "./V1DeterministicDeploymentBuilder.sol";
import {V1DeploymentPayload} from "./V1DeterministicDeploymentOrchestrator.sol";
import {V1ArbitrumDeploymentOrchestrator} from "./V1ArbitrumDeploymentOrchestrator.sol";
/// @notice Streaming release with isolated certificate and the same staged execution as the gated run().
contract DeployV1ArbitrumContinuousHolders is DeployV1ArbitrumStaged {
    error SimulationOnly();
    function _continuousHolderRewards() internal pure override returns (bool) { return true; }
    function _releaseInput(string memory path) internal view override returns (string memory) {
        if (keccak256(bytes(path)) == keccak256("../deployments/evidence/v1-current-release.json")) {
            return vm.readFile("../deployments/evidence/v1-continuous-candidate-release.json");
        }
        return super._releaseInput(path);
    }
    /// @notice Read-only certificate and payload validation; never loads a signing key.
    function validateCertificate() external view {
        ReleaseCertificate memory certificate = _assertReleaseEligibility();
        (V1BootstrapContext memory context, V1DeploymentPlan memory plan,) =
            _prepare(vm.envAddress("V1_EXPECTED_DEPLOYER"));
        _assertReleasePayload(certificate, context.deployer, context.releaseId, plan.payloadHash);
    }
    /// @notice Generate and simulate unsigned transactions. Explicitly rejects broadcast/resume contexts.
    /// @dev The inherited run() still requires a fresh certificate and the expected deployer key.
    function simulate() external returns (V1DeploymentPlan memory plan) {
        if (!vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) revert SimulationOnly();
        if (block.chainid != 421614) revert ChainIdMismatch(421614, block.chainid);
        V1BootstrapContext memory context;
        V1DeploymentPayload memory payload;
        (context, plan, payload) = _prepare(vm.envAddress("V1_EXPECTED_DEPLOYER"));
        vm.startBroadcast(context.deployer);
        _executeStaged(context, payload, plan);
        vm.stopBroadcast();
        _assertCompletedDeployment(V1ArbitrumDeploymentOrchestrator(context.orchestrator), plan);
        _logPlan(context, plan);
    }
}
