// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ProtocolFeeVault} from "../../../src/v1/modules/ProtocolFeeVault.sol";
import {ArbitrumTestTreasury} from "../../../script/v1/ArbitrumTestTreasury.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams as V4SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IStateView} from "@uniswap/v4-periphery/src/interfaces/IStateView.sol";
import {Test, console2} from "forge-std/Test.sol";

import {
    AssetView,
    CanonicalRoute,
    CreateMarketParams,
    LaunchTemplate,
    MarketView,
    TickerGardenBaseline,
    PositionView,
    PoolKey,
    QuoteAssetConfig,
    StockQuoteBinding,
    StockTokenFingerprint,
    ConversionItem
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {AllocationManager} from "../../../src/v1/modules/AllocationManager.sol";
import {ApprovedQuoteRegistry} from "../../../src/v1/modules/ApprovedQuoteRegistry.sol";
import {LaunchTemplateRegistry} from "../../../src/v1/modules/LaunchTemplateRegistry.sol";
import {MarketRegistryV1} from "../../../src/v1/modules/MarketRegistryV1.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {OfficialStockRegistryV1} from "../../../src/v1/modules/OfficialStockRegistryV1.sol";
import {TickerGardenBaselineRegistry} from "../../../src/v1/modules/TickerGardenBaselineRegistry.sol";
import {TickerGardenCurve} from "../../../src/v1/modules/TickerGardenCurve.sol";
import {LaunchAndBuyRouter} from "../../../src/v1/modules/LaunchAndBuyRouter.sol";
import {TickerGardenFactoryV1} from "../../../src/v1/modules/TickerGardenFactoryV1.sol";
import {TreasuryDistributorV1} from "../../../src/v1/modules/TreasuryDistributorV1.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {
    V1DeploymentConfig,
    V1DeploymentPlan,
    V1DeterministicDeploymentBuilder
} from "../../../script/v1/V1DeterministicDeploymentBuilder.sol";
import {
    V1DeploymentPayload,
    V1DeterministicDeploymentOrchestrator
} from "../../../script/v1/V1DeterministicDeploymentOrchestrator.sol";

interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
}

interface IProtocolFeeVaultFork {
    function creatorLiability(bytes32, uint32, address) external view returns (uint256);
    function holderLiability(bytes32, uint32, address) external view returns (uint256);
    function setSettlementOperator(address) external;
    function settleHolderRewards(bytes32, uint32, uint256, uint256, uint256) external returns (uint256, uint256);
    function fundHolderRewards(bytes32, uint32) external returns (uint256);
    function claimCreator(bytes32, uint32, address) external returns (uint256);
    function claimPlatform(bytes32, address) external returns (uint256);
    function liability(bytes32, address, uint8) external view returns (uint256);
    function requestRawRewardExit(bytes32) external;
    function settleRewards(bytes32, ConversionItem[] calldata, uint256, uint256) external returns (uint256, uint256);
    function platformTreasury() external view returns (address);
}

/// @notice Arbitrum Sepolia integration proof against official v4 deployments, with stock staking disabled.
/// @dev The test pins a recent block because the public RPC is not an archival endpoint. Long-lived CI must supply
///      an archive-capable ARBITRUM_SEPOLIA_RPC_URL that can still serve FORK_BLOCK_NUMBER.
contract V1ArbitrumSepoliaForkE2ETest is Test {
    uint256 private constant FORK_BLOCK_NUMBER = 305933430;
    bytes32 private constant FORK_BLOCK_HASH = 0x8860b0f870d770cc7907b0d9c60f4d7d8107252526709037e4bccf8af0fa9d42;

    address private constant POOL_MANAGER = address(bytes20(hex"fb3e0c6f74eb1a21cc1da29aec80d2dfe6c9a317"));
    address private constant POSITION_MANAGER = address(bytes20(hex"ac631556d3d4019c95769033b5e719dd77124bac"));
    address private constant PERMIT2 = address(bytes20(hex"000000000022d473030f116ddee9f6b43ac78ba3"));
    address private constant UNIVERSAL_ROUTER = address(bytes20(hex"efd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47"));
    address private constant V4_QUOTER = address(bytes20(hex"7de51022d70a725b508085468052e25e22b5c4c9"));
    IStateView private constant STATE_VIEW =
        IStateView(address(bytes20(hex"9d467fa9062b6e9b1a46e26007ad82db116c67cb")));

    bytes32 private constant BASELINE_ID = 0x78d3fa45758f93f793093e0ea0cd900f9aaade792dc1cb6a1d3567b1dc81881d;
    bytes32 private constant RELEASE_ID = keccak256("TICKERGARDEN_V1_ARB_SEPOLIA_INTEGRATION_2026_09_05");
    bytes32 private constant FEE_POLICY_ID = keccak256("TICKERGARDEN_V1_FEE_POLICY_40_30_30");
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-11");
    bytes32 private constant TEMPLATE_ID = keccak256("TICKERGARDEN_V1_FORK_TEMPLATE");
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 ether;
    uint256 private constant PHANTOM_QUOTE = 0.168 ether;
    uint256 private constant GRADUATION_THRESHOLD = 0.42 ether;
    uint256 private constant LAUNCH_FEE = 0.0005 ether;

    address private constant CREATOR = address(0xC0FFEE);
    address private constant STAKER = address(0xA11CE);
    address private constant HOLDER = address(0xB0B);

    V1DeploymentPlan private plan;
    OfficialStockRegistryV1 private stockRegistry;
    ApprovedQuoteRegistry private quoteRegistry;
    TickerGardenBaselineRegistry private baselineRegistry;
    LaunchTemplateRegistry private templateRegistry;
    MarketRegistryV1 private marketRegistry;
    AllocationManager private allocationManager;
    UserStockVault private stockVault;
    TreasuryDistributorV1 private treasuryDistributor;
    TickerGardenFactoryV1 private factory;
    bytes32 private quoteConfigId;

    receive() external payable {}

    function setUp() public {
        assertEq(block.chainid, 421614, "fork chain");
        assertEq(IArbSys(address(100)).arbBlockNumber(), FORK_BLOCK_NUMBER, "fork L2 block");
        _assertExternalState();
        _deployRuntimeGraph();
        _activateConfiguration();
    }

    /// @dev Fork-only proof of the holder-fee branch. The pool swap uses the real v4 PoolSwapTest helper against
    ///      the forked PoolManager; the one-holder TWAB is an explicitly synthetic test attestation.

    function test_disabledStakingRouterGraduationSwapAndHolderClaim() public {
        vm.deal(CREATOR, 30 ether);
        CreateMarketParams memory params = _marketParams(true, 500, keccak256("NO_STAKING_FORK"));
        params.stakingEnabled = false;
        params.assetUid = bytes32(0);
        params.expectedEconomics = factory.previewMarketEconomics(params);
        vm.prank(CREATOR);
        (bytes32 marketId, address memeToken,,) = LaunchAndBuyRouter(payable(plan.ordinaryComponents[9]))
        .launchAndBuy{value: LAUNCH_FEE + 0.01 ether}(
            params, 0.01 ether, 1, HOLDER
        );
        MarketView memory created = marketRegistry.market(marketId);
        assertFalse(created.config.stakingEnabled);
        assertEq(created.config.assetUid, bytes32(0));
        assertEq(created.config.gauge, address(0));
        vm.prank(CREATOR);
        TickerGardenCurve(payable(created.config.curve)).buy{value: 10 ether}(10 ether, 0, CREATOR);
        assertEq(marketRegistry.market(marketId).runtime.launchPhase, 1);
        _swapNativeForMeme(marketId);
        _settleAndClaimHolder(marketId, memeToken, plan.ordinaryComponents[15]);
    }

    function _swapNativeForMeme(bytes32 marketId) private {
        PoolKey memory key = marketRegistry.canonicalPoolKey(marketId);
        V4PoolKey memory v4Key = V4PoolKey({
            currency0: Currency.wrap(key.currency0),
            currency1: Currency.wrap(key.currency1),
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: IHooks(key.hooks)
        });
        PoolSwapTest swapper = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        V4SwapParams memory swapParams = V4SwapParams({
            zeroForOne: key.currency0 == address(0),
            amountSpecified: -int256(0.001 ether),
            sqrtPriceLimitX96: key.currency0 == address(0) ? 4295128740 + 1 : type(uint160).max - 1
        });
        PoolSwapTest.TestSettings memory settings =
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false});
        vm.deal(address(this), 1 ether);
        swapper.swap{value: 0.001 ether}(v4Key, swapParams, settings, "");
    }

    function _settleAndClaimHolder(bytes32 marketId, address memeToken, address feeVault) private {
        assertGt(IProtocolFeeVaultFork(feeVault).holderLiability(marketId, 1, memeToken), 0, "pool fee holder accrual");
        IProtocolFeeVaultFork vault = IProtocolFeeVaultFork(feeVault);
        vm.warp(block.timestamp + 7 days + 600);
        uint256 creatorMemeBefore = vault.creatorLiability(marketId, 1, memeToken);
        uint256 holderMeme = vault.holderLiability(marketId, 1, memeToken);
        if (holderMeme != 0) {
            vault.settleHolderRewards(marketId, 1, holderMeme, 1, block.timestamp + 5 minutes);
        }
        assertEq(vault.holderLiability(marketId, 1, memeToken), 0, "settled meme holder rewards");
        assertEq(
            vault.creatorLiability(marketId, 1, memeToken),
            creatorMemeBefore,
            "holder conversion cannot consume creator fees"
        );
        assertEq(vault.holderLiability(marketId, 2, address(0)), 0, "original holder epoch preserved");
        uint256 quoteLiability = vault.holderLiability(marketId, 1, address(0));
        assertGt(quoteLiability, 0, "native holder rewards");
        vm.prank(HOLDER);
        vault.fundHolderRewards(marketId, 1);
        assertEq(vault.holderLiability(marketId, 1, address(0)), 0, "funded holder rewards");
        uint256 epochAmount = treasuryDistributor.epochQuoteAmount(marketId, 1);
        vm.warp(block.timestamp + 7 days + 600);
        vm.deal(HOLDER, 0.01 ether);
        vm.roll(block.number + 100);
        vm.setBlockhash(block.number - 2, keccak256("TEST_ONLY_ROOT_FINALITY_BLOCK"));
        vm.prank(HOLDER);
        treasuryDistributor.requestRoot{value: 0.001 ether}(marketId, 1);
        bytes32 leaf = treasuryDistributor.claimLeaf(marketId, 1, 0, HOLDER, 1, epochAmount);
        treasuryDistributor.publishRoot(
            marketId, 1, leaf, keccak256("TEST_ONLY_SYNTHETIC_ONE_HOLDER_TWAB"), 1, 1, epochAmount
        );
        vm.warp(block.timestamp + 1 hours);
        treasuryDistributor.finalizeRoot(marketId, 1);
        uint256 beforeClaim = HOLDER.balance;
        treasuryDistributor.claim(marketId, 1, 0, HOLDER, 1, epochAmount, new bytes32[](0));
        assertEq(HOLDER.balance, beforeClaim + epochAmount, "holder claim");
        _claimCreatorAndPlatform(vault, marketId, memeToken, creatorMemeBefore);
    }

    function _claimCreatorAndPlatform(
        IProtocolFeeVaultFork vault, bytes32 marketId, address memeToken, uint256 creatorMemeBefore
    ) private {
        uint256 creatorMeme = vault.creatorLiability(marketId, 1, memeToken);
        assertGt(creatorMeme, 0, "creator meme accrual");
        assertEq(creatorMeme, creatorMemeBefore, "holder conversion preserves creator reward");
        uint256 creatorNativeBefore = CREATOR.balance;
        uint256 creatorTokenBefore = IERC20(memeToken).balanceOf(CREATOR);
        ConversionItem[] memory items = new ConversionItem[](1);
        items[0] = ConversionItem(CREATOR, 1, creatorMeme);
        (, uint256 convertedQuote) = vault.settleRewards(marketId, items, 1, block.timestamp + 240);
        assertGt(convertedQuote, 0, "creator conversion output");
        assertEq(vault.creatorLiability(marketId, 1, memeToken), 0, "creator meme converted");
        uint256 creatorQuote = vault.creatorLiability(marketId, 1, address(0));
        assertGe(creatorQuote, convertedQuote);
        assertEq(vault.claimCreator(marketId, 1, address(0)), creatorQuote);
        assertEq(CREATOR.balance, creatorNativeBefore + creatorQuote, "creator quote paid");
        assertEq(IERC20(memeToken).balanceOf(CREATOR), creatorTokenBefore, "creator meme stays internal");
        assertEq(vault.creatorLiability(marketId, 1, address(0)), 0);
        assertEq(vault.claimCreator(marketId, 1, address(0)), 0);
        _claimPlatformFees(vault, marketId, memeToken);
    }

    function _claimPlatformFees(IProtocolFeeVaultFork vault, bytes32 marketId, address memeToken) private {
        address platform = vault.platformTreasury();
        uint256 platformQuote = vault.liability(marketId, address(0), 2);
        uint256 platformMeme = vault.liability(marketId, memeToken, 2);
        assertGt(platformQuote, 0, "platform quote accrual");
        assertGt(platformMeme, 0, "platform meme accrual");
        uint256 platformNativeBefore = platform.balance;
        uint256 platformTokenBefore = IERC20(memeToken).balanceOf(platform);
        assertEq(vault.claimPlatform(marketId, address(0)), platformQuote);
        assertEq(vault.claimPlatform(marketId, memeToken), platformMeme);
        assertEq(platform.balance, platformNativeBefore + platformQuote, "platform quote paid");
        assertEq(IERC20(memeToken).balanceOf(platform), platformTokenBefore + platformMeme, "platform meme paid");
        assertEq(vault.liability(marketId, address(0), 2), 0);
        assertEq(vault.liability(marketId, memeToken, 2), 0);
        assertEq(vault.claimPlatform(marketId, address(0)), 0);
        assertEq(vault.claimPlatform(marketId, memeToken), 0);
    }

    function _marketParams(bool holderFees, uint16 taxBps, bytes32 salt)
        private
        view
        returns (CreateMarketParams memory params)
    {
        params = CreateMarketParams({
            assetUid: bytes32(0),
            tickerGardenBaselineId: BASELINE_ID,
            quoteAssetConfigId: quoteConfigId,
            launchTemplateId: TEMPLATE_ID,
            expectedEconomics: bytes32(0),
            creatorRevenueBeneficiary: CREATOR,
            name: "TickerGarden Arbitrum Integration",
            symbol: "tgARBtest",
            metadataURI: "ipfs://tickergarden/fork/arbitrum-test",
            salt: salt,
            creatorTaxBps: taxBps,
            creatorFeesToHolders: holderFees,
            stakingEnabled: false
        });
    }

    function _assertExternalState() private view {
        assertEq(POOL_MANAGER.codehash, 0x790926015bb866adc59a6619aaddd47273949f6b3a4e4b43efc9eab8a9c93cdb);
        assertEq(POSITION_MANAGER.codehash, 0x80ef9e16bafa80a5c631677d12fc256774aaeb63068d4ca597b0e743f7a738e2);
        assertEq(PERMIT2.codehash, 0x055d90ff6146107f315c7c306b841138ec59c541a8e4e04df787c38ce400a1e4);
        assertEq(UNIVERSAL_ROUTER.codehash, 0xd1b72cad4c9dffc62de6226f90ca8d5d9dfa6650149caeddacff8edfc9d83608);
        assertEq(V4_QUOTER.codehash, 0x67860b76a19b774bd9eea3c29095d29138cfdcd19df2df79b708d73794c63fef);
        assertEq(address(STATE_VIEW).codehash, 0x496980635f4d3596ebe9d577a736f5d181c418532151e5590671b8c972dfd3bc);
    }

    function _deployRuntimeGraph() private {
        ArbitrumTestTreasury receiver = new ArbitrumTestTreasury(address(this));
        V1DeploymentConfig memory config = V1DeploymentConfig({
            initialAdmin: address(this),
            poolManager: POOL_MANAGER,
            nativeQuotePoolFee: 10_000,
            nativeQuoteTickSpacing: 200,
            positionManager: POSITION_MANAGER,
            swapRouter: UNIVERSAL_ROUTER,
            quoter: V4_QUOTER,
            platformTreasury: address(receiver),
            rootServiceTreasury: address(0xBEEF),
            rootServiceFeeAsset: address(0),
            rootServiceFeeAmount: 0.001 ether,
            finalityDelaySeconds: 10 minutes,
            finalityDelayBlocks: 2,
            rootPublicationWindow: 1 days,
            rootReviewDelay: 1 hours,
            claimWindow: 30 days,
            feePolicyId: FEE_POLICY_ID
        });
        V1DeterministicDeploymentOrchestrator orchestrator =
            new V1DeterministicDeploymentOrchestrator(address(this), RELEASE_ID);
        (bytes32 helperSalt,) =
            V1DeterministicDeploymentBuilder.mineHelperSalt(address(orchestrator), RELEASE_ID, 500_000);
        bytes32 factorySalt = V1DeterministicDeploymentBuilder.factorySalt(block.chainid, RELEASE_ID);
        V1DeploymentPayload memory payload;
        (plan, payload) = V1DeterministicDeploymentBuilder.build(address(orchestrator), config, helperSalt, factorySalt);
        orchestrator.deploy(payload, plan.payloadHash);
        receiver.configureSettlementOperator(plan.ordinaryComponents[15], address(this));
        assertEq(ProtocolFeeVault(payable(plan.ordinaryComponents[15])).settlementOperator(), address(this));

        stockRegistry = OfficialStockRegistryV1(plan.ordinaryComponents[1]);
        quoteRegistry = ApprovedQuoteRegistry(plan.ordinaryComponents[2]);
        baselineRegistry = TickerGardenBaselineRegistry(plan.ordinaryComponents[3]);
        templateRegistry = LaunchTemplateRegistry(plan.ordinaryComponents[4]);
        marketRegistry = MarketRegistryV1(plan.ordinaryComponents[10]);
        allocationManager = AllocationManager(plan.ordinaryComponents[12]);
        stockVault = UserStockVault(plan.ordinaryComponents[13]);
        treasuryDistributor = TreasuryDistributorV1(payable(plan.ordinaryComponents[14]));
        factory = TickerGardenFactoryV1(plan.factory);
    }

    function _activateConfiguration() private {
        // Synthetic baseline reference fixture only; not a production deployment attestation.
        baselineRegistry.addBaseline(
            BASELINE_ID,
            TickerGardenBaseline({
                referenceChainId: 421614,
                referenceFactory: address(this),
                referenceFactoryCodeHash: address(this).codehash,
                launchConfigId: 0,
                supply: INITIAL_SUPPLY,
                curveFeeBps: 100,
                poolFee: 0,
                tickSpacing: 200,
                behaviorVectorRoot: keccak256("spec/v1_pons_behavior_vectors.json"),
                status: 1
            })
        );

        quoteConfigId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_QUOTE_ECONOMICS"),
                uint256(1),
                block.chainid,
                BASELINE_ID,
                address(0),
                uint8(18),
                PHANTOM_QUOTE,
                GRADUATION_THRESHOLD
            )
        );
        quoteRegistry.addQuoteConfig(
            quoteConfigId,
            QuoteAssetConfig({
                tickerGardenBaselineId: BASELINE_ID,
                quoteAsset: address(0),
                quoteDecimals: 18,
                phantomQuote: PHANTOM_QUOTE,
                graduationThreshold: GRADUATION_THRESHOLD,
                economicsHash: quoteConfigId,
                status: 1
            })
        );

        templateRegistry.addLaunchTemplate(
            TEMPLATE_ID,
            LaunchTemplate({
                memeTokenImplementation: plan.ordinaryComponents[6],
                memeTokenCodeHash: plan.ordinaryComponents[6].codehash,
                curveImplementation: plan.ordinaryComponents[7],
                curveCodeHash: plan.ordinaryComponents[7].codehash,
                gaugeImplementation: plan.ordinaryComponents[8],
                gaugeCodeHash: plan.ordinaryComponents[8].codehash,
                graduatedHook: plan.hook,
                hookCodeHash: plan.hook.codehash,
                graduationExecutor: plan.executor,
                graduationExecutorCodeHash: plan.executor.codehash,
                feePolicyId: FEE_POLICY_ID,
                executionSpecId: EXECUTION_SPEC_ID,
                status: 1
            })
        );
    }
}
