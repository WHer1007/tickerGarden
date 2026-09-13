// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Test} from "forge-std/Test.sol";

import {HolderRewardsDistributorV1} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {GraduationExecutor} from "../../../src/v1/modules/GraduationExecutor.sol";
import {LaunchAndBuyRouter} from "../../../src/v1/modules/LaunchAndBuyRouter.sol";
import {MarketRegistryV1} from "../../../src/v1/modules/MarketRegistryV1.sol";
import {ProtocolFeeVault} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {TickerGardenFactoryV1} from "../../../src/v1/modules/TickerGardenFactoryV1.sol";
import {TickerGardenMemeHook} from "../../../src/v1/modules/TickerGardenMemeHook.sol";
import {
    V1DeploymentConfig,
    V1DeploymentPlan,
    V4DeterministicDeploymentBuilder
} from "../../../script/v1/V4DeterministicDeploymentBuilder.sol";
import {
    V1DeploymentPayload,
    V1DeterministicDeploymentOrchestrator
} from "../../../script/v1/V1DeterministicDeploymentOrchestrator.sol";

contract V1DeploymentCodeStub {}

contract V1DeploymentPositionManagerStub {
    IPoolManager public immutable poolManager;
    IAllowanceTransfer public immutable permit2;

    constructor(address poolManager_, address permit2_) {
        poolManager = IPoolManager(poolManager_);
        permit2 = IAllowanceTransfer(permit2_);
    }
}

contract V1DeploymentTreasuryStub {
    receive() external payable {}
}

contract V1DeterministicDeploymentOrchestratorTest is Test {
    using V4DeterministicDeploymentBuilder for address;

    bytes32 private constant RELEASE_ID = keccak256("TICKERGARDEN_V1_TEST_RELEASE");
    bytes32 private constant FEE_POLICY_ID = keccak256("TICKERGARDEN_V1_FEE_POLICY_TEST");

    V1DeploymentConfig private config;

    function setUp() public {
        V1DeploymentCodeStub poolManager = new V1DeploymentCodeStub();
        V1DeploymentCodeStub permit2 = new V1DeploymentCodeStub();
        V1DeploymentPositionManagerStub positionManager =
            new V1DeploymentPositionManagerStub(address(poolManager), address(permit2));
        V1DeploymentCodeStub swapRouter = new V1DeploymentCodeStub();
        V1DeploymentCodeStub quoter = new V1DeploymentCodeStub();
        V1DeploymentTreasuryStub platformTreasury = new V1DeploymentTreasuryStub();
        V1DeploymentTreasuryStub rootServiceTreasury = new V1DeploymentTreasuryStub();

        config = V1DeploymentConfig({
            initialAdmin: address(this),
            poolManager: address(poolManager),
            positionManager: address(positionManager),
            platformTreasury: address(platformTreasury),
            feePolicyId: FEE_POLICY_ID
        });
    }

    function test_deploysExactAtomicRuntimeGraph() public {
        V1DeterministicDeploymentOrchestrator orchestrator =
            new V1DeterministicDeploymentOrchestrator(address(this), RELEASE_ID);
        (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload) = _build(orchestrator);

        (address factory, address hook, address executor) = orchestrator.deploy(payload, plan.payloadHash);

        assertTrue(orchestrator.completed());
        assertEq(orchestrator.deploymentPayloadHash(), plan.payloadHash);
        assertEq(orchestrator.factory(), plan.factory);
        assertEq(orchestrator.helper(), plan.helper);
        assertEq(factory, plan.factory);
        assertEq(hook, plan.hook);
        assertEq(executor, plan.executor);
        assertTrue(V4DeterministicDeploymentBuilder.hookMaskMatches(hook));

        address[16] memory actual = orchestrator.ordinaryComponents();
        for (uint8 i; i < actual.length; ++i) {
            assertEq(actual[i], plan.ordinaryComponents[i]);
            assertEq(actual[i], orchestrator.predictOrdinaryComponent(i));
            assertGt(actual[i].code.length, 0);
        }

        TickerGardenFactoryV1 deployedFactory = TickerGardenFactoryV1(factory);
        MarketRegistryV1 marketRegistry = MarketRegistryV1(plan.ordinaryComponents[10]);
        LaunchAndBuyRouter launchRouter = LaunchAndBuyRouter(payable(plan.ordinaryComponents[9]));
        ProtocolFeeVault feeVault = ProtocolFeeVault(payable(plan.ordinaryComponents[15]));
        TickerGardenMemeHook deployedHook = TickerGardenMemeHook(payable(hook));
        GraduationExecutor deployedExecutor = GraduationExecutor(payable(executor));

        assertEq(marketRegistry.factory(), factory);
        assertEq(marketRegistry.graduationExecutor(), executor);
        assertEq(launchRouter.factory(), factory);
        assertEq(deployedHook.graduationExecutor(), executor);
        assertEq(deployedExecutor.hook(), hook);
        assertEq(feeVault.marketRegistry(), address(marketRegistry));
        assertEq(address(deployedFactory.marketRegistry()), address(marketRegistry));
        assertEq(deployedFactory.protocolFeeVault(), address(feeVault));
    }

    function test_walletSnapshotReleaseDeploysBoundRuntimeGraph() public {
        V1DeterministicDeploymentOrchestrator orchestrator =
            new V1DeterministicDeploymentOrchestrator(address(this), RELEASE_ID);
        (bytes32 salt,) = V4DeterministicDeploymentBuilder.mineHelperSalt(address(orchestrator), RELEASE_ID, 200_000);
        bytes32 factorySalt = V4DeterministicDeploymentBuilder.factorySalt(block.chainid, RELEASE_ID);
        (V1DeploymentPlan memory repeated,) = _build(orchestrator);
        (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload) =
            V4DeterministicDeploymentBuilder.build(address(orchestrator), config, salt, factorySalt);
        assertEq(plan.payloadHash, repeated.payloadHash);
        orchestrator.deploy(payload, plan.payloadHash);
        HolderRewardsDistributorV1 rewards = HolderRewardsDistributorV1(plan.ordinaryComponents[14]);
        assertEq(rewards.marketRegistry(), plan.ordinaryComponents[10]);
        assertEq(rewards.rewardMode(), keccak256("TICKERGARDEN_HOLDER_WALLET_SNAPSHOT_V1"));
        assertEq(rewards.snapshotPublisher(), address(0));
        assertEq(TickerGardenFactoryV1(plan.factory).holderRewardsDistributor(), address(rewards));
        assertTrue(orchestrator.completed());
    }

    function test_anyFailureRollsBackEveryComponentAndExactRetrySucceeds() public {
        V1DeterministicDeploymentOrchestrator orchestrator =
            new V1DeterministicDeploymentOrchestrator(address(this), keccak256("ROLLBACK_RETRY"));
        (V1DeploymentPlan memory plan, V1DeploymentPayload memory validPayload) = _build(orchestrator);
        V1DeploymentPayload memory brokenPayload = validPayload;
        brokenPayload.ordinaryInitCodes[15] = hex"00";

        vm.expectRevert();
        orchestrator.deploy(brokenPayload, keccak256(abi.encode(brokenPayload)));

        assertFalse(orchestrator.completed());
        for (uint8 i; i < plan.ordinaryComponents.length; ++i) {
            assertEq(plan.ordinaryComponents[i].code.length, 0);
        }
        assertEq(plan.helper.code.length, 0);
        assertEq(plan.hook.code.length, 0);
        assertEq(plan.executor.code.length, 0);
        assertEq(plan.factory.code.length, 0);

        (plan, validPayload) = _build(orchestrator);
        orchestrator.deploy(validPayload, plan.payloadHash);
        assertTrue(orchestrator.completed());
        assertEq(orchestrator.factory(), plan.factory);
    }

    function test_rejectsUnauthorizedHashDriftAndSecondExecution() public {
        V1DeterministicDeploymentOrchestrator orchestrator =
            new V1DeterministicDeploymentOrchestrator(address(this), keccak256("AUTH_HASH_ONESHOT"));
        (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload) = _build(orchestrator);

        vm.prank(address(0xBEEF));
        vm.expectRevert(
            abi.encodeWithSelector(
                V1DeterministicDeploymentOrchestrator.UnauthorizedDeployment.selector, address(0xBEEF), address(this)
            )
        );
        orchestrator.deploy(payload, plan.payloadHash);

        vm.expectPartialRevert(V1DeterministicDeploymentOrchestrator.InvalidPayloadHash.selector);
        orchestrator.deploy(payload, bytes32(uint256(plan.payloadHash) ^ 1));

        orchestrator.deploy(payload, plan.payloadHash);
        vm.expectRevert(V1DeterministicDeploymentOrchestrator.DeploymentAlreadyCompleted.selector);
        orchestrator.deploy(payload, plan.payloadHash);
    }

    function _build(V1DeterministicDeploymentOrchestrator orchestrator)
        private
        view
        returns (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload)
    {
        (bytes32 helperSalt,) =
            V4DeterministicDeploymentBuilder.mineHelperSalt(address(orchestrator), RELEASE_ID, 200_000);
        bytes32 factorySalt = V4DeterministicDeploymentBuilder.factorySalt(block.chainid, RELEASE_ID);
        return V4DeterministicDeploymentBuilder.build(address(orchestrator), config, helperSalt, factorySalt);
    }
}
