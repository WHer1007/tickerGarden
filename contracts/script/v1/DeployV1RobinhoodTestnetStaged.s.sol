// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {V1HolderModeSelection} from "./V1HolderModeSelection.sol";

import {console2} from "forge-std/Script.sol";

import {
    V1DeploymentConfig,
    V1DeploymentPlan,
    V4DeterministicDeploymentBuilder
} from "./V4DeterministicDeploymentBuilder.sol";
import {V1DeploymentPayload} from "./V1DeterministicDeploymentOrchestrator.sol";
import {
    V1RobinhoodTestnetDeploymentOrchestrator as V1DeterministicDeploymentOrchestrator
} from "./V1RobinhoodTestnetDeploymentOrchestrator.sol";

import {V1ReleaseGate} from "./V1ReleaseGate.sol";

interface IV1PositionManagerBinding {
    function poolManager() external view returns (address);

    function permit2() external view returns (address);
}

struct V1BootstrapContext {
    uint256 privateKey;
    address deployer;
    bytes32 releaseId;
    bytes orchestratorInitCode;
    bytes32 orchestratorSalt;
    address orchestrator;
    bytes32 helperSalt;
    uint256 helperSaltAttempts;
    bytes32 factorySalt;
}

/// @notice Fail-closed, idempotent broadcast entry point for the immutable V1 runtime graph.
/// @dev The script intentionally does not configure registries, grant roles, create a market, or transfer admin.
///      Those operations use a separately reviewed, receipt-bound activation plan after this runtime is verified.
contract DeployV1RobinhoodTestnetStaged is V1ReleaseGate {
    address internal constant CANONICAL_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant CANONICAL_CREATE2_DEPLOYER_CODEHASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;

    uint256 internal constant MAXIMUM_HOOK_SALT_ATTEMPTS = 500_000;

    error ChainIdMismatch(uint256 expected, uint256 actual);
    error AddressMismatch(string field, address expected, address actual);
    error CodeHashMismatch(string field, address target, bytes32 expected, bytes32 actual);
    error EmptyCode(string field, address target);
    error InvalidConfiguration(string field);
    error ValueOutOfRange(string field, uint256 value, uint256 maximum);
    error CanonicalDeploymentFailed(address predictedOrchestrator);
    error ExistingOrchestratorMismatch(address orchestrator);
    error CompletedDeploymentMismatch(string field, address expected, address actual);

    function run() external returns (V1DeploymentPlan memory plan) {
        ReleaseCertificate memory certificate = _assertReleaseEligibility();
        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        _assertAddress("V1_EXPECTED_DEPLOYER", vm.envAddress("V1_EXPECTED_DEPLOYER"), deployer);

        V1BootstrapContext memory context;
        V1DeploymentPayload memory payload;
        (context, plan, payload) = _prepare(deployer);
        _assertReleasePayload(certificate, deployer, context.releaseId, plan.payloadHash);
        context.privateKey = privateKey;
        _assertAddress("V1_EXPECTED_ORCHESTRATOR", vm.envAddress("V1_EXPECTED_ORCHESTRATOR"), context.orchestrator);

        _broadcast(context, payload, plan);
        _logPlan(context, plan);
    }

    /// @notice Computes and validates the complete deterministic address plan without loading a private key.
    /// @dev Invoke with `--sig "preview()"`; the expected deployer is the future broadcast account.
    function preview() external view returns (V1DeploymentPlan memory plan) {
        V1BootstrapContext memory context;
        (context, plan,) = _prepare(vm.envAddress("V1_EXPECTED_DEPLOYER"));
        _logPlan(context, plan);
    }

    function _prepare(address deployer)
        internal
        view
        returns (V1BootstrapContext memory context, V1DeploymentPlan memory plan, V1DeploymentPayload memory payload)
    {
        V1HolderModeSelection.validate(vm.envOr("V1_DEPLOYMENT_HOLDER_MODE", string("")), true);
        if (deployer == address(0)) revert InvalidConfiguration("V1_EXPECTED_DEPLOYER");
        context.deployer = deployer;
        uint256 expectedChainId = vm.envUint("V1_EXPECTED_CHAIN_ID");
        if (block.chainid != expectedChainId) revert ChainIdMismatch(expectedChainId, block.chainid);
        _assertCodeHash("CANONICAL_CREATE2_DEPLOYER", CANONICAL_CREATE2_DEPLOYER, CANONICAL_CREATE2_DEPLOYER_CODEHASH);

        context.releaseId = vm.envBytes32("V1_RELEASE_ID");
        if (context.releaseId == bytes32(0)) revert InvalidConfiguration("V1_RELEASE_ID");

        V1DeploymentConfig memory config = _loadConfiguration();
        _assertAddress("V1_INITIAL_ADMIN", context.deployer, config.initialAdmin);
        _validateExternalGraph(config);

        context.orchestratorInitCode = bytes.concat(
            type(V1DeterministicDeploymentOrchestrator).creationCode, abi.encode(context.deployer, context.releaseId)
        );
        context.orchestratorSalt = V4DeterministicDeploymentBuilder.orchestratorSalt(block.chainid, context.releaseId);
        context.orchestrator = V4DeterministicDeploymentBuilder.predictCreate2(
            CANONICAL_CREATE2_DEPLOYER, context.orchestratorSalt, keccak256(context.orchestratorInitCode)
        );

        (context.helperSalt, context.helperSaltAttempts) = V4DeterministicDeploymentBuilder.mineHelperSalt(
            context.orchestrator, context.releaseId, MAXIMUM_HOOK_SALT_ATTEMPTS
        );
        context.factorySalt = V4DeterministicDeploymentBuilder.factorySalt(block.chainid, context.releaseId);
        (plan, payload) = V4DeterministicDeploymentBuilder.build(
            context.orchestrator, config, context.helperSalt, context.factorySalt
        );
        if (!V4DeterministicDeploymentBuilder.hookMaskMatches(plan.hook)) {
            revert InvalidConfiguration("HOOK_PERMISSION_MASK");
        }
    }


    function _broadcast(
        V1BootstrapContext memory context,
        V1DeploymentPayload memory payload,
        V1DeploymentPlan memory plan
    ) private {
        vm.startBroadcast(context.privateKey);
        _executeStaged(context, payload, plan);
        vm.stopBroadcast();
        _assertCompletedDeployment(V1DeterministicDeploymentOrchestrator(context.orchestrator), plan);
    }

    function _executeStaged(
        V1BootstrapContext memory context,
        V1DeploymentPayload memory payload,
        V1DeploymentPlan memory plan
    ) internal {
        if (context.orchestrator.code.length == 0) {
            (bool success,) = CANONICAL_CREATE2_DEPLOYER.call(
                bytes.concat(context.orchestratorSalt, context.orchestratorInitCode)
            );
            if (!success || context.orchestrator.code.length == 0) {
                revert CanonicalDeploymentFailed(context.orchestrator);
            }
        }

        V1DeterministicDeploymentOrchestrator orchestrator = V1DeterministicDeploymentOrchestrator(context.orchestrator);
        _assertExistingOrchestrator(orchestrator, context.deployer, context.releaseId);
        bytes32[16] memory hashes;
        bytes[] memory codes = payload.ordinaryInitCodes;
        for (uint8 i; i < 16; ++i) {
            hashes[i] = keccak256(codes[i]);
        }
        payload.ordinaryInitCodes = new bytes[](0);
        bytes32 finalHash = keccak256(abi.encode(payload));
        if (!orchestrator.initialized()) orchestrator.begin(plan.payloadHash, hashes, finalHash);
        if (orchestrator.deploymentPayloadHash() != plan.payloadHash || orchestrator.finalHash() != finalHash) {
            revert ExistingOrchestratorMismatch(address(orchestrator));
        }
        for (uint8 i; i < 16; ++i) {
            if (orchestrator.initCodeHashes(i) != hashes[i]) {
                revert ExistingOrchestratorMismatch(address(orchestrator));
            }
        }
        if (!orchestrator.completed()) {
            for (uint8 i = orchestrator.nextComponent(); i < 16; ++i) {
                orchestrator.deployComponent(i, codes[i]);
            }
            orchestrator.finish(payload);
        }
    }

    function _loadConfiguration() private view returns (V1DeploymentConfig memory config) {
        config = V1DeploymentConfig({
            initialAdmin: vm.envAddress("V1_INITIAL_ADMIN"),
            poolManager: vm.envAddress("V1_POOL_MANAGER"),
            nativeQuotePoolFee: _toUint24("V1_NATIVE_QUOTE_POOL_FEE", vm.envUint("V1_NATIVE_QUOTE_POOL_FEE")),
            nativeQuoteTickSpacing: _toInt24("V1_NATIVE_QUOTE_TICK_SPACING", vm.envInt("V1_NATIVE_QUOTE_TICK_SPACING")),
            positionManager: vm.envAddress("V1_POSITION_MANAGER"),
            swapRouter: vm.envAddress("V1_SWAP_ROUTER"),
            quoter: vm.envAddress("V1_QUOTER"),
            platformTreasury: vm.envAddress("V1_PLATFORM_TREASURY"),
            feePolicyId: vm.envBytes32("V1_FEE_POLICY_ID")
        });

        if (config.initialAdmin == address(0)) revert InvalidConfiguration("V1_INITIAL_ADMIN");
        if (config.platformTreasury == address(0)) revert InvalidConfiguration("V1_PLATFORM_TREASURY");
        if (config.feePolicyId == bytes32(0)) revert InvalidConfiguration("V1_FEE_POLICY_ID");
    }

    function _validateExternalGraph(V1DeploymentConfig memory config) private view {
        _assertConfiguredCodeHash("V1_POOL_MANAGER", config.poolManager, "V1_POOL_MANAGER_CODEHASH");
        _assertConfiguredCodeHash("V1_POSITION_MANAGER", config.positionManager, "V1_POSITION_MANAGER_CODEHASH");
        _assertConfiguredCodeHash(
            "V1_PERMIT2", IV1PositionManagerBinding(config.positionManager).permit2(), "V1_PERMIT2_CODEHASH"
        );
        _assertConfiguredCodeHash("V1_SWAP_ROUTER", config.swapRouter, "V1_SWAP_ROUTER_CODEHASH");
        _assertConfiguredCodeHash("V1_QUOTER", config.quoter, "V1_QUOTER_CODEHASH");
        _validatePlatformTreasury(
            config.platformTreasury, config.initialAdmin, vm.envBytes32("V1_PLATFORM_TREASURY_CODEHASH")
        );

        _assertAddress(
            "POSITION_MANAGER_POOL_MANAGER",
            config.poolManager,
            IV1PositionManagerBinding(config.positionManager).poolManager()
        );
        _assertAddress(
            "V1_PERMIT2", vm.envAddress("V1_PERMIT2"), IV1PositionManagerBinding(config.positionManager).permit2()
        );
        if (config.swapRouter == config.quoter) revert InvalidConfiguration("ROUTER_QUOTER_ALIAS");
    }

    function _assertExistingOrchestrator(
        V1DeterministicDeploymentOrchestrator orchestrator,
        address deployer,
        bytes32 releaseId
    ) private view {
        try orchestrator.authorizer() returns (address authorizer) {
            if (authorizer != deployer || orchestrator.releaseId() != releaseId) {
                revert ExistingOrchestratorMismatch(address(orchestrator));
            }
        } catch {
            revert ExistingOrchestratorMismatch(address(orchestrator));
        }
    }

    function _assertCompletedDeployment(
        V1DeterministicDeploymentOrchestrator orchestrator,
        V1DeploymentPlan memory plan
    ) internal view {
        if (!orchestrator.completed() || orchestrator.deploymentPayloadHash() != plan.payloadHash) {
            revert ExistingOrchestratorMismatch(address(orchestrator));
        }
        _assertCompletedAddress("factory", plan.factory, orchestrator.factory());
        _assertCompletedAddress("helper", plan.helper, orchestrator.helper());
        _assertCompletedAddress("hook", plan.hook, orchestrator.hook());
        _assertCompletedAddress("executor", plan.executor, orchestrator.executor());

        address[16] memory actual = orchestrator.ordinaryComponents();
        for (uint8 i; i < actual.length; ++i) {
            _assertCompletedAddress("ordinaryComponent", plan.ordinaryComponents[i], actual[i]);
            if (actual[i].code.length == 0) revert EmptyCode("ordinaryComponent", actual[i]);
        }
    }

    /// @dev Match the Factory dependency requirement on every network.
    function _validatePlatformTreasury(address treasury, address, bytes32 expected) internal view {
        _assertCodeHash("V1_PLATFORM_TREASURY", treasury, expected);
    }

    function _assertConfiguredCodeHash(string memory field, address target, string memory hashEnvironment)
        private
        view
    {
        _assertCodeHash(field, target, vm.envBytes32(hashEnvironment));
    }

    function _assertCodeHash(string memory field, address target, bytes32 expected) private view {
        if (target.code.length == 0) revert EmptyCode(field, target);
        bytes32 actual = target.codehash;
        if (actual != expected) revert CodeHashMismatch(field, target, expected, actual);
    }

    function _assertAddress(string memory field, address expected, address actual) private pure {
        if (actual != expected) revert AddressMismatch(field, expected, actual);
    }

    function _assertCompletedAddress(string memory field, address expected, address actual) private pure {
        if (actual != expected) revert CompletedDeploymentMismatch(field, expected, actual);
    }

    function _toUint128(string memory field, uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert ValueOutOfRange(field, value, type(uint128).max);
        return uint128(value);
    }

    function _toUint24(string memory field, uint256 value) private pure returns (uint24) {
        if (value > type(uint24).max) revert ValueOutOfRange(field, value, type(uint24).max);
        return uint24(value);
    }

    function _toInt24(string memory field, int256 value) private pure returns (int24) {
        if (value < type(int24).min || value > type(int24).max) {
            revert InvalidConfiguration(field);
        }
        return int24(value);
    }

    function _toUint32(string memory field, uint256 value) private pure returns (uint32) {
        if (value > type(uint32).max) revert ValueOutOfRange(field, value, type(uint32).max);
        return uint32(value);
    }

    function _toUint16(string memory field, uint256 value) private pure returns (uint16) {
        if (value > type(uint16).max) revert ValueOutOfRange(field, value, type(uint16).max);
        return uint16(value);
    }

    function _logPlan(V1BootstrapContext memory context, V1DeploymentPlan memory plan) internal pure {
        console2.log("V1 release id");
        console2.logBytes32(context.releaseId);
        console2.log("orchestrator", context.orchestrator);
        console2.log("orchestrator salt");
        console2.logBytes32(context.orchestratorSalt);
        console2.log("helper", plan.helper);
        console2.log("helper salt");
        console2.logBytes32(context.helperSalt);
        console2.log("helper salt attempts", context.helperSaltAttempts);
        console2.log("hook", plan.hook);
        console2.log("executor", plan.executor);
        console2.log("factory", plan.factory);
        console2.log("factory salt");
        console2.logBytes32(context.factorySalt);
        console2.log("payload hash");
        console2.logBytes32(plan.payloadHash);
    }
}
