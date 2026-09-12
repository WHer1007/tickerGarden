// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {Test} from "forge-std/Test.sol";

import {GraduationExecutor} from "../../../src/v1/modules/GraduationExecutor.sol";
import {LaunchAndBuyRouter} from "../../../src/v1/modules/LaunchAndBuyRouter.sol";
import {MarketRegistryV1} from "../../../src/v1/modules/MarketRegistryV1.sol";
import {HolderAccountingHarness as HolderRewardsDistributorV1} from "../mocks/HolderAccountingHarness.sol";
import {ProtocolFeeVault} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {TickerGardenFactoryV1} from "../../../src/v1/modules/TickerGardenFactoryV1.sol";
import {TickerGardenMemeHook} from "../../../src/v1/modules/TickerGardenMemeHook.sol";
import {
    V1DeploymentConfig,
    V1DeploymentPlan,
    V4DeterministicDeploymentBuilder
} from "../../../script/v1/V4DeterministicDeploymentBuilder.sol";
import {V1DeploymentPayload} from "../../../script/v1/V1DeterministicDeploymentOrchestrator.sol";

import {
    V1ArbitrumDeploymentOrchestrator as V1DeterministicDeploymentOrchestrator
} from "../../../script/v1/V1ArbitrumDeploymentOrchestrator.sol";

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

contract V1ArbitrumDeploymentOrchestratorTest is Test {
    using V4DeterministicDeploymentBuilder for address;

    bytes32 private constant RELEASE_ID = keccak256("TICKERGARDEN_V1_TEST_RELEASE");
    bytes32 private constant FEE_POLICY_ID = keccak256("TICKERGARDEN_V1_FEE_POLICY_TEST");

    V1DeploymentConfig private config;

    function setUp() public {
        vm.chainId(421614);
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
            swapRouter: address(swapRouter),
            quoter: address(quoter),
            platformTreasury: address(platformTreasury),
            feePolicyId: FEE_POLICY_ID
        });
    }

    function test_stagedGraphHasExactBindingsAndBoundedTransactions() public {
        V1DeterministicDeploymentOrchestrator orchestrator =
            new V1DeterministicDeploymentOrchestrator(address(this), RELEASE_ID);
        (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload) = _build(orchestrator);

        bytes[] memory codes = payload.ordinaryInitCodes;
        bytes32[16] memory hashes;
        for (uint8 i; i < 16; ++i) {
            hashes[i] = keccak256(codes[i]);
        }
        payload.ordinaryInitCodes = new bytes[](0);
        orchestrator.begin(plan.payloadHash, hashes, keccak256(abi.encode(payload)));
        vm.expectRevert();
        orchestrator.finish(payload);
        for (uint8 i; i < 16; ++i) {
            assertLt(abi.encodeCall(orchestrator.deployComponent, (i, codes[i])).length, 90000);
            vm.prank(address(0xBEEF));
            vm.expectRevert();
            orchestrator.deployComponent(i, codes[i]);
            vm.expectRevert();
            orchestrator.deployComponent(i, hex"00");
            orchestrator.deployComponent(i, codes[i]);
            vm.expectRevert();
            orchestrator.deployComponent(i, codes[i]);
            assertEq(orchestrator.nextComponent(), i + 1);
        }
        assertLt(abi.encodeCall(orchestrator.finish, (payload)).length, 90000);
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        orchestrator.finish(payload);
        bytes32 salt = payload.factorySalt;
        payload.factorySalt = bytes32(uint256(salt) ^ 1);
        vm.expectRevert();
        orchestrator.finish(payload);
        payload.factorySalt = salt;
        (address factory, address hook, address executor) = orchestrator.finish(payload);
        vm.expectRevert();
        orchestrator.finish(payload);
        vm.expectRevert();
        orchestrator.begin(plan.payloadHash, hashes, keccak256(abi.encode(payload)));

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

    function test_continuousStagedResumePreservesCommitmentsAndBindings() public {
        V1DeterministicDeploymentOrchestrator o = new V1DeterministicDeploymentOrchestrator(address(this), RELEASE_ID);
        (bytes32 helperSalt,) = V4DeterministicDeploymentBuilder.mineHelperSalt(address(o), RELEASE_ID, 200_000);
        bytes32 salt = V4DeterministicDeploymentBuilder.factorySalt(block.chainid, RELEASE_ID);
        (V1DeploymentPlan memory plan, V1DeploymentPayload memory payload) =
            V4DeterministicDeploymentBuilder.build(address(o), config, helperSalt, salt);
        (V1DeploymentPlan memory repeated,) = _build(o);
        assertEq(plan.payloadHash, repeated.payloadHash);
        bytes[] memory codes = payload.ordinaryInitCodes;
        bytes32[16] memory hashes;
        for (uint8 i; i < 16; ++i) {
            hashes[i] = keccak256(codes[i]);
            assertLt(abi.encodeCall(o.deployComponent, (i, codes[i])).length, 90000);
        }
        payload.ordinaryInitCodes = new bytes[](0);
        o.begin(plan.payloadHash, hashes, keccak256(abi.encode(payload)));
        for (uint8 i; i < 14; ++i) {
            o.deployComponent(i, codes[i]);
        }
        assertEq(o.nextComponent(), 14);
        assertFalse(o.completed());
        assertEq(plan.ordinaryComponents[14].code.length, 0);
        vm.roll(block.number + 1);
        vm.expectRevert();
        o.deployComponent(14, bytes.concat(codes[14], hex"00"));
        vm.expectRevert();
        o.finish(payload);
        o.deployComponent(14, codes[14]);
        o.deployComponent(15, codes[15]);
        assertLt(abi.encodeCall(o.finish, (payload)).length, 90000);
        o.finish(payload);
        assertTrue(o.completed());
        HolderRewardsDistributorV1 distributor = HolderRewardsDistributorV1(payable(plan.ordinaryComponents[14]));
        assertEq(address(distributor.marketRegistry()), plan.ordinaryComponents[10]);
        assertEq(distributor.STREAM_DURATION(), 24 hours);
        assertEq(TickerGardenFactoryV1(plan.factory).holderRewardsDistributor(), address(distributor));
        assertEq(ProtocolFeeVault(payable(plan.ordinaryComponents[15])).marketRegistry(), plan.ordinaryComponents[10]);
        assertEq(o.deploymentPayloadHash(), plan.payloadHash);
    }

    function test_productionRejected() public {
        vm.chainId(4663);
        vm.expectRevert();
        new V1DeterministicDeploymentOrchestrator(address(this), RELEASE_ID);
    }

    function test_beginCannotBeHijackedOrReplaced() public {
        V1DeterministicDeploymentOrchestrator o = new V1DeterministicDeploymentOrchestrator(address(this), RELEASE_ID);
        bytes32[16] memory hashes;
        for (uint8 i; i < 16; ++i) {
            hashes[i] = keccak256(abi.encode(i));
        }
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        o.begin(RELEASE_ID, hashes, RELEASE_ID);
        o.begin(RELEASE_ID, hashes, RELEASE_ID);
        vm.expectRevert();
        o.begin(RELEASE_ID, hashes, RELEASE_ID);
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
