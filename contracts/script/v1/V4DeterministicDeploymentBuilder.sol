// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AccessManager} from "@openzeppelin/contracts/access/manager/AccessManager.sol";

import {AllocationManager} from "../../src/v1/modules/AllocationManager.sol";
import {ApprovedQuoteRegistry} from "../../src/v1/modules/ApprovedQuoteRegistry.sol";
import {CreatorRevenueRegistry} from "../../src/v1/modules/CreatorRevenueRegistry.sol";
import {GraduationExecutor} from "../../src/v1/modules/GraduationExecutor.sol";
import {LaunchAndBuyRouter} from "../../src/v1/modules/LaunchAndBuyRouter.sol";
import {LaunchConfigResolver} from "../../src/v1/modules/LaunchConfigResolver.sol";
import {LaunchTemplateRegistry} from "../../src/v1/modules/LaunchTemplateRegistry.sol";
import {MarketRegistryV1} from "../../src/v1/modules/MarketRegistryV1.sol";
import {MemeStockGauge} from "../../src/v1/modules/MemeStockGauge.sol";
import {OfficialStockRegistryV1} from "../../src/v1/modules/OfficialStockRegistryV1.sol";
import {TickerGardenBaselineRegistry} from "../../src/v1/modules/TickerGardenBaselineRegistry.sol";
import {ProtocolFeeVault, ProtocolFeeVaultInit} from "../../src/v1/modules/ProtocolFeeVault.sol";
import {
    TickerGardenCurveImplementation,
    TickerGardenFactoryInit,
    TickerGardenFactoryV1,
    TickerMemeTokenV1Implementation
} from "../../src/v1/modules/TickerGardenFactoryV1.sol";
import {TickerGardenMemeHook} from "../../src/v1/modules/TickerGardenMemeHook.sol";
import {HolderRewardsDistributorV1} from "../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {UserStockVault} from "../../src/v1/modules/UserStockVault.sol";
import {V1HookExecutorDeployer} from "./V1HookExecutorDeployer.sol";
import {V1DeploymentPayload} from "./V1DeterministicDeploymentOrchestrator.sol";

import {V1DeploymentConfig, V1DeploymentPlan} from "./V1DeploymentTypes.sol";

/// @notice Frozen init-code and address planner used by the broadcast script, fork tests, and manifest generator.
library V4DeterministicDeploymentBuilder {
    uint160 internal constant REQUIRED_HOOK_PERMISSION_MASK = 0x2044;
    uint160 internal constant ALL_HOOK_PERMISSION_BITS = 0x3fff;

    bytes32 internal constant ORCHESTRATOR_SALT_DOMAIN = keccak256("TICKERGARDEN_V1_ORCHESTRATOR_SALT");
    bytes32 internal constant HELPER_SALT_DOMAIN = keccak256("TICKERGARDEN_V1_HOOK_HELPER_SALT");
    bytes32 internal constant FACTORY_SALT_DOMAIN = keccak256("TICKERGARDEN_V1_FACTORY_SALT");

    error HookSaltNotFound(address orchestrator, bytes32 releaseId, uint256 maximumAttempts);

    uint8 internal constant ACCESS_MANAGER = 0;
    uint8 internal constant OFFICIAL_STOCK_REGISTRY = 1;
    uint8 internal constant APPROVED_QUOTE_REGISTRY = 2;
    uint8 internal constant LAUNCH_BASELINE_REGISTRY = 3;
    uint8 internal constant LAUNCH_TEMPLATE_REGISTRY = 4;
    uint8 internal constant LAUNCH_CONFIG_RESOLVER = 5;
    uint8 internal constant MEME_TOKEN_IMPLEMENTATION = 6;
    uint8 internal constant CURVE_IMPLEMENTATION = 7;
    uint8 internal constant GAUGE_IMPLEMENTATION = 8;
    uint8 internal constant LAUNCH_ROUTER = 9;
    uint8 internal constant MARKET_REGISTRY = 10;
    uint8 internal constant CREATOR_REVENUE_REGISTRY = 11;
    uint8 internal constant ALLOCATION_MANAGER = 12;
    uint8 internal constant USER_STOCK_VAULT = 13;
    uint8 internal constant HOLDER_REWARDS_DISTRIBUTOR = 14;
    uint8 internal constant PROTOCOL_FEE_VAULT = 15;

    function build(
        address orchestrator,
        V1DeploymentConfig memory config,
        bytes32 helperDeploymentSalt,
        bytes32 factoryDeploymentSalt
    ) internal pure returns (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload) {
        for (uint8 i; i < 16; ++i) {
            plan.ordinaryComponents[i] = predictCreateAddress(orchestrator, i + 1);
        }

        payload.helperSalt = helperDeploymentSalt;
        payload.helperInitCode = bytes.concat(type(V1HookExecutorDeployer).creationCode, abi.encode(orchestrator));
        plan.helper = predictCreate2(orchestrator, helperDeploymentSalt, keccak256(payload.helperInitCode));
        plan.hook = predictCreateAddress(plan.helper, 1);
        plan.executor = predictCreateAddress(plan.helper, 2);

        payload.factorySalt = factoryDeploymentSalt;
        payload.factoryInitCode = _factoryInitCode(plan.ordinaryComponents, config);
        plan.factory = predictCreate2(orchestrator, factoryDeploymentSalt, keccak256(payload.factoryInitCode));

        payload.ordinaryInitCodes = _ordinaryInitCodes(plan, config);
        payload.hookInitCode = bytes.concat(
            type(TickerGardenMemeHook).creationCode,
            abi.encode(
                plan.ordinaryComponents[MARKET_REGISTRY],
                config.poolManager,
                plan.ordinaryComponents[PROTOCOL_FEE_VAULT],
                plan.executor
            )
        );
        payload.executorInitCode = bytes.concat(
            type(GraduationExecutor).creationCode,
            abi.encode(
                plan.ordinaryComponents[MARKET_REGISTRY],
                plan.ordinaryComponents[APPROVED_QUOTE_REGISTRY],
                config.poolManager,
                config.positionManager,
                plan.hook
            )
        );
        plan.payloadHash = keccak256(abi.encode(payload));
    }

    function hookMaskMatches(address hook) internal pure returns (bool) {
        return uint160(hook) & ALL_HOOK_PERMISSION_BITS == REQUIRED_HOOK_PERMISSION_MASK;
    }

    function orchestratorSalt(uint256 chainId, bytes32 releaseId) internal pure returns (bytes32) {
        return keccak256(abi.encode(ORCHESTRATOR_SALT_DOMAIN, uint256(1), chainId, releaseId));
    }

    function factorySalt(uint256 chainId, bytes32 releaseId) internal pure returns (bytes32) {
        return keccak256(abi.encode(FACTORY_SALT_DOMAIN, uint256(1), chainId, releaseId));
    }

    function mineHelperSalt(address orchestrator, bytes32 releaseId, uint256 maximumAttempts)
        internal
        pure
        returns (bytes32 salt, uint256 attempts)
    {
        bytes memory helperInitCode = bytes.concat(type(V1HookExecutorDeployer).creationCode, abi.encode(orchestrator));
        bytes32 initCodeHash = keccak256(helperInitCode);

        for (uint256 candidate; candidate < maximumAttempts; ++candidate) {
            salt = keccak256(abi.encode(HELPER_SALT_DOMAIN, uint256(1), releaseId, candidate));
            address helper = predictCreate2(orchestrator, salt, initCodeHash);
            if (hookMaskMatches(predictCreateAddress(helper, 1))) return (salt, candidate + 1);
        }

        revert HookSaltNotFound(orchestrator, releaseId, maximumAttempts);
    }

    function predictCreateAddress(address deployer, uint8 nonce) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(hex"d694", deployer, bytes1(nonce))))));
    }

    function predictCreate2(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
    }

    function _ordinaryInitCodes(V1DeploymentPlan memory plan, V1DeploymentConfig memory config)
        private
        pure
        returns (bytes[] memory initCodes)
    {
        address[16] memory components = plan.ordinaryComponents;
        initCodes = new bytes[](16);
        initCodes[ACCESS_MANAGER] = bytes.concat(type(AccessManager).creationCode, abi.encode(config.initialAdmin));
        initCodes[OFFICIAL_STOCK_REGISTRY] =
            bytes.concat(type(OfficialStockRegistryV1).creationCode, abi.encode(components[ACCESS_MANAGER]));
        initCodes[APPROVED_QUOTE_REGISTRY] = bytes.concat(
            type(ApprovedQuoteRegistry).creationCode,
            abi.encode(components[ACCESS_MANAGER], components[OFFICIAL_STOCK_REGISTRY])
        );
        initCodes[LAUNCH_BASELINE_REGISTRY] =
            bytes.concat(type(TickerGardenBaselineRegistry).creationCode, abi.encode(components[ACCESS_MANAGER]));
        initCodes[LAUNCH_TEMPLATE_REGISTRY] =
            bytes.concat(type(LaunchTemplateRegistry).creationCode, abi.encode(components[ACCESS_MANAGER]));
        initCodes[LAUNCH_CONFIG_RESOLVER] = bytes.concat(
            type(LaunchConfigResolver).creationCode,
            abi.encode(
                components[APPROVED_QUOTE_REGISTRY],
                components[LAUNCH_BASELINE_REGISTRY],
                components[LAUNCH_TEMPLATE_REGISTRY]
            )
        );
        initCodes[MEME_TOKEN_IMPLEMENTATION] = type(TickerMemeTokenV1Implementation).creationCode;
        initCodes[CURVE_IMPLEMENTATION] = type(TickerGardenCurveImplementation).creationCode;
        initCodes[GAUGE_IMPLEMENTATION] = type(MemeStockGauge).creationCode;
        initCodes[LAUNCH_ROUTER] = bytes.concat(
            type(LaunchAndBuyRouter).creationCode,
            abi.encode(
                plan.factory,
                components[APPROVED_QUOTE_REGISTRY],
                config.poolManager,
                config.nativeQuotePoolFee,
                config.nativeQuoteTickSpacing
            )
        );
        initCodes[MARKET_REGISTRY] = bytes.concat(
            type(MarketRegistryV1).creationCode,
            abi.encode(
                plan.factory,
                components[OFFICIAL_STOCK_REGISTRY],
                components[APPROVED_QUOTE_REGISTRY],
                components[LAUNCH_BASELINE_REGISTRY],
                components[LAUNCH_TEMPLATE_REGISTRY],
                plan.executor,
                config.swapRouter,
                config.quoter
            )
        );
        initCodes[CREATOR_REVENUE_REGISTRY] = bytes.concat(
            type(CreatorRevenueRegistry).creationCode, abi.encode(plan.factory, components[MARKET_REGISTRY])
        );
        initCodes[ALLOCATION_MANAGER] = bytes.concat(
            type(AllocationManager).creationCode,
            abi.encode(components[OFFICIAL_STOCK_REGISTRY], components[MARKET_REGISTRY])
        );
        initCodes[USER_STOCK_VAULT] = bytes.concat(
            type(UserStockVault).creationCode,
            abi.encode(components[OFFICIAL_STOCK_REGISTRY], components[MARKET_REGISTRY], components[ALLOCATION_MANAGER])
        );
        initCodes[HOLDER_REWARDS_DISTRIBUTOR] =
            bytes.concat(type(HolderRewardsDistributorV1).creationCode, abi.encode(components[MARKET_REGISTRY]));
        initCodes[PROTOCOL_FEE_VAULT] = bytes.concat(
            type(ProtocolFeeVault).creationCode,
            abi.encode(
                ProtocolFeeVaultInit({
                    authority: components[ACCESS_MANAGER],
                    marketRegistry: components[MARKET_REGISTRY],
                    poolManager: config.poolManager,
                    creatorRevenueRegistry: components[CREATOR_REVENUE_REGISTRY],
                    platformTreasury: config.platformTreasury,
                    feePolicyId: config.feePolicyId
                })
            )
        );
    }

    function _factoryInitCode(address[16] memory components, V1DeploymentConfig memory config)
        private
        pure
        returns (bytes memory)
    {
        return bytes.concat(
            type(TickerGardenFactoryV1).creationCode,
            abi.encode(
                TickerGardenFactoryInit({
                    officialStockRegistry: components[OFFICIAL_STOCK_REGISTRY],
                    approvedQuoteRegistry: components[APPROVED_QUOTE_REGISTRY],
                    tickerGardenBaselineRegistry: components[LAUNCH_BASELINE_REGISTRY],
                    launchTemplateRegistry: components[LAUNCH_TEMPLATE_REGISTRY],
                    marketRegistry: components[MARKET_REGISTRY],
                    creatorRevenueRegistry: components[CREATOR_REVENUE_REGISTRY],
                    protocolFeeVault: components[PROTOCOL_FEE_VAULT],
                    allocationManager: components[ALLOCATION_MANAGER],
                    launchRouter: components[LAUNCH_ROUTER],
                    platformTreasury: config.platformTreasury,
                    holderRewardsDistributor: components[HOLDER_REWARDS_DISTRIBUTOR],
                    memeTokenImplementation: components[MEME_TOKEN_IMPLEMENTATION],
                    curveImplementation: components[CURVE_IMPLEMENTATION],
                    gaugeImplementation: components[GAUGE_IMPLEMENTATION],
                    feePolicyId: config.feePolicyId
                })
            )
        );
    }
}
