// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

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
import {HolderRewardsDistributorV1} from "../../../src/v1/modules/HolderRewardsDistributorV1.sol";
import {CreatorRevenueRegistry} from "../../../src/v1/modules/CreatorRevenueRegistry.sol";
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

/// @notice Real Robinhood Chain state-fork proof for immutable Stock admission, atomic v4 graduation and rageQuit.
/// @dev The test pins a recent block because the public RPC is not an archival endpoint. Long-lived CI must supply
///      an archive-capable ROBINHOOD_RPC_URL that can still serve FORK_BLOCK_NUMBER.
contract V1ProductForkE2ETest is Test {
    uint256 private constant FORK_BLOCK_NUMBER = 55747994;
    bytes32 private constant FORK_BLOCK_HASH = 0xd7bc428f76e456752aed5c129204b1aed67239a2cb824f1be544d41dcd60df78;
    uint256 private constant FORK_L1_BLOCK_NUMBER = 25916380;

    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address private constant V4_QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;
    IStateView private constant STATE_VIEW = IStateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b);

    address private constant PONS_REFERENCE_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    bytes32 private constant PONS_REFERENCE_FACTORY_CODEHASH =
        0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84;

    bytes32 private constant CRM_ASSET_UID = 0x00000000000000000000000000000000022015c295294037bfe416d3e45327b9;
    address private constant CRM_STOCK_TOKEN = 0xd95B44124e475743a7589e68F3D74008A5536D44;
    address private constant CRM_BEACON = 0xe10b6f6B275de231345c20D14Ab812db62151b00;
    address private constant CRM_IMPLEMENTATION = 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2;
    bytes32 private constant CRM_TOKEN_CODEHASH = 0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630;
    bytes32 private constant CRM_BEACON_CODEHASH = 0x8b465c0b53a2ba499566e9b4ca67d8c90ed6131743df806a570d156956a7e90e;
    bytes32 private constant CRM_IMPLEMENTATION_CODEHASH =
        0xdc07e86ee482f99641bdafb9a0d772846b167401e094d90a666b94dbdcd1eec7;

    bytes32 private constant BASELINE_ID = 0x78d3fa45758f93f793093e0ea0cd900f9aaade792dc1cb6a1d3567b1dc81881d;
    bytes32 private constant RELEASE_ID = keccak256("TICKERGARDEN_V1_FORK_E2E_2026_09_05");
    bytes32 private constant FEE_POLICY_ID = keccak256("TICKERGARDEN_V1_FEE_POLICY_40_30_30");
    bytes32 private constant EXECUTION_SPEC_ID = keccak256("V1-EXEC-11");
    bytes32 private constant TEMPLATE_ID = keccak256("TICKERGARDEN_V1_FORK_TEMPLATE");
    bytes32 private constant STOCK_QUOTE_REFERENCE_EVIDENCE_HASH = keccak256("FORK_ONLY_CRM_REFERENCE_EVIDENCE");
    bytes32 private constant STOCK_QUOTE_GENERATOR_POLICY_ID = keccak256("FORK_ONLY_STOCK_QUOTE_GENERATOR_POLICY");
    uint256 private constant INITIAL_SUPPLY = 1_000_000_000 ether;
    uint256 private constant PHANTOM_QUOTE = 1.68 ether;
    uint256 private constant GRADUATION_THRESHOLD = 4.2 ether;
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
        assertEq(block.chainid, 4663, "fork chain");
        assertEq(IArbSys(address(100)).arbBlockNumber(), FORK_BLOCK_NUMBER, "fork L2 block");
        assertEq(block.number, FORK_L1_BLOCK_NUMBER, "fork L1 block");
        _assertExternalState();
        _deployRuntimeGraph();
        _activateConfiguration();
    }

    function test_realStockIdentityAtomicGraduationAndPrincipalFirstRageQuit() public {
        (bytes32 marketId,, address curve, address gauge) = _createMarket(false, 0, "TICKERGARDEN_V1_CRM_FORK_MARKET");
        CanonicalRoute memory route = _graduateMarket(marketId, curve);
        _exercisePrincipalFirstRageQuit(marketId, gauge);

        console2.log("fork block", FORK_BLOCK_NUMBER);
        console2.log("fork block hash");
        console2.logBytes32(FORK_BLOCK_HASH);
        console2.log("market", uint256(marketId));
        console2.log("factory", address(factory));
        console2.log("hook", plan.hook);
        console2.log("locker", route.launchLocker);
    }

    /// @dev Fork-only proof of the holder-fee branch. The pool swap uses the real v4 PoolSwapTest helper against
    ///      the forked PoolManager; the one-holder TWAB is an explicitly synthetic test attestation.
    function test_realRouterHolderFeesTaxPoolSwapAndAttestedEpochClaim() public {
        vm.deal(CREATOR, 30 ether);
        CreateMarketParams memory params = _marketParams(true, 500, keccak256("TICKERGARDEN_V1_CRM_HOLDER_FORK_MARKET"));
        vm.prank(CREATOR);
        params.expectedEconomics = factory.previewMarketEconomics(params);

        LaunchAndBuyRouter router = LaunchAndBuyRouter(payable(plan.ordinaryComponents[9]));
        vm.prank(CREATOR);
        (bytes32 marketId, address memeToken,,) =
            router.launchAndBuy{value: LAUNCH_FEE + 0.01 ether}(params, 0.01 ether, 1, HOLDER);
        address curve = marketRegistry.market(marketId).config.curve;
        assertGt(IERC20(memeToken).balanceOf(HOLDER), 0, "router first buy holder balance");
        assertEq(TickerGardenCurve(payable(curve)).creatorTaxBps(), 500, "creator tax");
        vm.prank(CREATOR);
        TickerGardenCurve(payable(curve)).buy{value: 10 ether}(10 ether, 0, CREATOR);
        MarketView memory graduated = marketRegistry.market(marketId);
        assertEq(graduated.runtime.launchPhase, 1, "graduated");
        address feeVault = plan.ordinaryComponents[15];
        uint256 creatorCurveLiability = IProtocolFeeVaultFork(feeVault).creatorLiability(marketId, 1, address(0));
        uint256 holderCurveLiability = IProtocolFeeVaultFork(feeVault).holderLiability(marketId, 1, address(0));
        assertGt(creatorCurveLiability, 0, "creator tax and fee independent");
        assertGt(holderCurveLiability, 0, "curve holder fee");
        assertGt(creatorCurveLiability, holderCurveLiability, "tax remains creator-owned");

        _swapNativeForMeme(marketId);
        _settleAndClaimHolder(marketId, memeToken, feeVault);
    }

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

    /// @dev Current streaming release against real v4 contracts; no root or ArbSys hash adapter.
    function test_continuousReleaseRealV4ConversionAnytimeClaimAndCreatorHandoff() public {
        _deployRuntimeGraph(true);
        _activateConfiguration();
        vm.deal(CREATOR, 30 ether);
        CreateMarketParams memory params = _marketParams(true, 500, keccak256("CONTINUOUS_RH_FORK"));
        params.stakingEnabled = false;
        params.assetUid = bytes32(0);
        params.expectedEconomics = factory.previewMarketEconomics(params);
        vm.prank(CREATOR);
        (bytes32 id, address token,,) = LaunchAndBuyRouter(payable(plan.ordinaryComponents[9]))
            .launchAndBuy{value: LAUNCH_FEE + 0.01 ether}(params, 0.01 ether, 1, HOLDER);
        MarketView memory market = marketRegistry.market(id);
        vm.prank(CREATOR);
        TickerGardenCurve(payable(market.config.curve)).buy{value: 10 ether}(10 ether, 0, CREATOR);
        assertEq(marketRegistry.market(id).runtime.launchPhase, 1);
        _swapNativeForMeme(id);
        _verifyContinuousClaim(id, token);
    }

    function _verifyContinuousClaim(bytes32 id, address token) private {
        IProtocolFeeVaultFork vault = IProtocolFeeVaultFork(plan.ordinaryComponents[15]);
        HolderRewardsDistributorV1 distributor = HolderRewardsDistributorV1(payable(plan.ordinaryComponents[14]));
        vault.setSettlementOperator(address(this));
        uint256 creatorMeme = vault.creatorLiability(id, 1, token);
        uint256 pendingMeme = vault.holderLiability(id, 1, token);
        assertGt(pendingMeme, 0);
        vault.settleHolderRewards(id, 1, pendingMeme, 1, block.timestamp + 5 minutes);
        assertEq(vault.holderLiability(id, 1, token), 0);
        assertEq(vault.creatorLiability(id, 1, token), creatorMeme, "separate creator balance");
        vault.fundHolderRewards(id, 1);
        assertEq(distributor.lastFundingAt(id), block.timestamp);
        assertEq(distributor.claimable(id, HOLDER), 0, "no instant reward on funding");
        vm.warp(block.timestamp + 12 hours);
        uint256 earned = distributor.claimable(id, HOLDER);
        assertGt(earned, 0);
        uint256 beforeBalance = HOLDER.balance;
        vm.prank(HOLDER);
        assertEq(distributor.claim(id), earned);
        assertEq(HOLDER.balance, beforeBalance + earned);
        // Earnings remain the seller's; a recipient cannot inherit previously earned rewards.
        uint256 holderTokens = IERC20(token).balanceOf(HOLDER);
        vm.prank(HOLDER);
        IERC20(token).transfer(STAKER, holderTokens);
        assertEq(distributor.claimable(id, STAKER), 0);
        vm.warp(block.timestamp + 12 hours);
        assertEq(distributor.claimable(id, HOLDER), 0);
        assertGt(distributor.claimable(id, STAKER), 0);
        vm.prank(STAKER);
        distributor.claim(id);
        CreatorRevenueRegistry revenue = CreatorRevenueRegistry(factory.creatorRevenueRegistry());
        vm.prank(CREATOR);
        revenue.transferCreatorRevenueBeneficiary(id, STAKER);
        assertEq(revenue.currentCreatorEpoch(id), 1, "nomination does not change attribution");
        vm.prank(STAKER);
        revenue.acceptCreatorRevenueBeneficiary(id);
        assertEq(revenue.currentCreatorEpoch(id), 2);
        assertEq(revenue.creatorBeneficiaryAt(id, 1), CREATOR, "historical beneficiary remains");
        assertEq(revenue.creatorBeneficiaryAt(id, 2), STAKER);
        _claimCreatorAndPlatform(vault, id, token, creatorMeme);
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
        vm.prank(address(this));
        vault.setSettlementOperator(address(this));
        vm.warp(block.timestamp + 31 days);
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
        vm.warp(block.timestamp + 31 days);
        vm.deal(HOLDER, 0.01 ether);
        // Foundry does not emulate Nitro arbBlockHash. Both the block header and this
        // exact precompile call were checked via live RPC at pinned block 55747994.
        // Scope the test adapter to one selector/height; do not mock protocol contracts.
        vm.mockCall(address(100), abi.encodeWithSignature("arbBlockHash(uint256)", FORK_BLOCK_NUMBER - 2),
            abi.encode(bytes32(0x0acd8b1dace2891f5fb2ea1d4a028bd6e06613c8255f023b5041dd2b84e42e11)));
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

        // The no-gauge path must leave creator and platform fee buckets claimable in both assets.
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

    function _createMarket(bool holderFees, uint16 taxBps, string memory saltText)
        private
        returns (bytes32 marketId, address memeToken, address curve, address gauge)
    {
        vm.deal(CREATOR, 20 ether);
        CreateMarketParams memory params = _marketParams(holderFees, taxBps, keccak256(bytes(saltText)));
        vm.prank(CREATOR);
        params.expectedEconomics = factory.previewMarketEconomics(params);

        vm.prank(CREATOR);
        (marketId, memeToken, curve, gauge) = factory.createMarket{value: LAUNCH_FEE}(params);
        treasuryDistributor.registerMarket(
            marketId, memeToken, address(0), keccak256("TICKERGARDEN_V1_TREASURY_HOLDER_TWAB")
        );
    }

    function _marketParams(bool holderFees, uint16 taxBps, bytes32 salt)
        private
        view
        returns (CreateMarketParams memory params)
    {
        params = CreateMarketParams({
            assetUid: CRM_ASSET_UID,
            tickerGardenBaselineId: BASELINE_ID,
            quoteAssetConfigId: quoteConfigId,
            launchTemplateId: TEMPLATE_ID,
            expectedEconomics: bytes32(0),
            creatorRevenueBeneficiary: CREATOR,
            name: "TickerGarden CRM Fork",
            symbol: "tgCRM",
            metadataURI: "ipfs://tickergarden/fork/crm",
            salt: salt,
            creatorTaxBps: taxBps,
            creatorFeesToHolders: holderFees,
            stakingEnabled: true
        });
    }

    function _graduateMarket(bytes32 marketId, address curve) private returns (CanonicalRoute memory route) {
        vm.prank(CREATOR);
        (uint256 tokensOut, uint256 quoteSpent) =
            TickerGardenCurve(payable(curve)).buy{value: 10 ether}(10 ether, 0, CREATOR);
        assertGt(tokensOut, 0, "final buy tokens");
        assertLt(quoteSpent, 10 ether, "partial-fill refund");

        MarketView memory graduated = marketRegistry.market(marketId);
        assertEq(graduated.runtime.launchPhase, 1, "atomic PoolCreated");
        assertNotEq(graduated.runtime.poolId, bytes32(0), "canonical pool id");
        route = marketRegistry.canonicalRoute(marketId);
        assertEq(route.poolId, graduated.runtime.poolId, "route pool");
        assertEq(route.hook, plan.hook, "route hook");
        assertGt(route.launchLocker.code.length, 0, "permanent locker");
        (uint160 sqrtPriceX96,, uint24 protocolFee, uint24 lpFee) = STATE_VIEW.getSlot0(PoolId.wrap(route.poolId));
        assertGt(sqrtPriceX96, 0, "v4 pool initialized");
        assertEq(protocolFee, 0, "v4 protocol fee");
        assertEq(lpFee, 0, "v4 LP fee");
        treasuryDistributor.activateMarket(marketId);
    }

    function _exercisePrincipalFirstRageQuit(bytes32 marketId, address gauge) private {
        uint256 principal = 1 ether;
        deal(CRM_STOCK_TOKEN, STAKER, principal, true);
        assertEq(IERC20(CRM_STOCK_TOKEN).balanceOf(STAKER), principal, "synthetic fork funding");
        vm.startPrank(STAKER);
        IERC20(CRM_STOCK_TOKEN).approve(address(stockVault), principal);
        stockVault.depositStock(CRM_ASSET_UID, principal);
        allocationManager.allocate(marketId, principal);
        PositionView memory pendingPosition = MemeStockGauge(gauge).positionOf(STAKER);
        assertEq(pendingPosition.pendingAmount, principal, "pending allocation");
        allocationManager.rageQuit(marketId);
        vm.stopPrank();

        PositionView memory exitedPosition = MemeStockGauge(gauge).positionOf(STAKER);
        assertEq(exitedPosition.activeAmount, 0, "no active stake");
        assertEq(exitedPosition.pendingAmount, 0, "no pending stake");
        assertEq(exitedPosition.quoteClaimable, 0, "quote reward forfeited");
        assertEq(exitedPosition.memeClaimable, 0, "meme reward forfeited");
        assertEq(stockVault.allocation(CRM_ASSET_UID, STAKER, marketId), 0, "allocation cleared");
        assertEq(stockVault.deposited(CRM_ASSET_UID, STAKER), 0, "deposit ledger cleared");
        assertEq(IERC20(CRM_STOCK_TOKEN).balanceOf(STAKER), principal, "principal returned");
        assertEq(marketRegistry.market(marketId).runtime.launchPhase, 1, "rageQuit does not stop market");
    }

    function _assertExternalState() private view {
        assertEq(POOL_MANAGER.codehash, 0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626);
        assertEq(POSITION_MANAGER.codehash, 0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2);
        assertEq(PERMIT2.codehash, 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca);
        assertEq(UNIVERSAL_ROUTER.codehash, 0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde);
        assertEq(V4_QUOTER.codehash, 0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6);
        assertEq(address(STATE_VIEW).codehash, 0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6);
        assertEq(PONS_REFERENCE_FACTORY.codehash, PONS_REFERENCE_FACTORY_CODEHASH);
        assertEq(CRM_STOCK_TOKEN.codehash, CRM_TOKEN_CODEHASH);
        assertEq(CRM_BEACON.codehash, CRM_BEACON_CODEHASH);
        assertEq(CRM_IMPLEMENTATION.codehash, CRM_IMPLEMENTATION_CODEHASH);

        (bool uidOk, bytes memory uidData) = CRM_STOCK_TOKEN.staticcall(abi.encodeWithSignature("uid()"));
        (bool decimalsOk, bytes memory decimalsData) = CRM_STOCK_TOKEN.staticcall(abi.encodeWithSignature("decimals()"));
        assertTrue(uidOk && uidData.length == 32, "CRM uid call");
        assertTrue(decimalsOk && decimalsData.length == 32, "CRM decimals call");
        assertEq(abi.decode(uidData, (bytes32)), CRM_ASSET_UID, "CRM uid");
        assertEq(abi.decode(decimalsData, (uint256)), 18, "CRM decimals");
    }

    function _deployRuntimeGraph() private { _deployRuntimeGraph(false); }

    function _deployRuntimeGraph(bool continuous) private {
        V1DeploymentConfig memory config = V1DeploymentConfig({
            initialAdmin: address(this),
            poolManager: POOL_MANAGER,
            nativeQuotePoolFee: 10_000,
            nativeQuoteTickSpacing: 200,
            positionManager: POSITION_MANAGER,
            swapRouter: UNIVERSAL_ROUTER,
            quoter: V4_QUOTER,
            platformTreasury: address(this),
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
        if (continuous) (plan, payload) = V1DeterministicDeploymentBuilder.buildContinuous(address(orchestrator), config, helperSalt, factorySalt);
        else (plan, payload) = V1DeterministicDeploymentBuilder.build(address(orchestrator), config, helperSalt, factorySalt);
        orchestrator.deploy(payload, plan.payloadHash);

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
        stockRegistry.registerAsset(
            CRM_ASSET_UID,
            CRM_STOCK_TOKEN,
            18,
            address(stockVault),
            0.5 ether,
            StockTokenFingerprint({
                tokenRuntimeCodeHash: CRM_TOKEN_CODEHASH,
                beacon: CRM_BEACON,
                beaconRuntimeCodeHash: CRM_BEACON_CODEHASH,
                implementation: CRM_IMPLEMENTATION,
                implementationRuntimeCodeHash: CRM_IMPLEMENTATION_CODEHASH
            })
        );
        assertTrue(stockRegistry.assetIdentityCurrent(CRM_ASSET_UID), "CRM fingerprint current");

        baselineRegistry.addBaseline(
            BASELINE_ID,
            TickerGardenBaseline({
                referenceChainId: 4663,
                referenceFactory: PONS_REFERENCE_FACTORY,
                referenceFactoryCodeHash: PONS_REFERENCE_FACTORY_CODEHASH,
                launchConfigId: 0,
                supply: INITIAL_SUPPLY,
                curveFeeBps: 100,
                poolFee: 0,
                tickSpacing: 200,
                behaviorVectorRoot: keccak256("spec/v1_pons_behavior_vectors.json"),
                status: 1
            })
        );

        _admitRealStockQuoteForForkEvidence();

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

    function _admitRealStockQuoteForForkEvidence() private {
        AssetView memory asset = stockRegistry.asset(CRM_ASSET_UID);
        StockTokenFingerprint memory fingerprint = stockRegistry.assetFingerprint(CRM_ASSET_UID);
        StockQuoteBinding memory binding = StockQuoteBinding({
            assetUid: CRM_ASSET_UID,
            stockTokenFingerprintHash: keccak256(
                abi.encode(
                    keccak256("TICKERGARDEN_V1_STOCK_QUOTE_FINGERPRINT"),
                    uint256(1),
                    block.chainid,
                    CRM_ASSET_UID,
                    asset.stockToken,
                    asset.tokenDecimals,
                    fingerprint.tokenRuntimeCodeHash,
                    fingerprint.beacon,
                    fingerprint.beaconRuntimeCodeHash,
                    fingerprint.implementation,
                    fingerprint.implementationRuntimeCodeHash
                )
            ),
            referenceEvidenceHash: STOCK_QUOTE_REFERENCE_EVIDENCE_HASH,
            generatorPolicyId: STOCK_QUOTE_GENERATOR_POLICY_ID
        });
        QuoteAssetConfig memory config = QuoteAssetConfig({
            tickerGardenBaselineId: BASELINE_ID,
            quoteAsset: CRM_STOCK_TOKEN,
            quoteDecimals: 18,
            phantomQuote: 2 ether,
            graduationThreshold: 5 ether,
            economicsHash: bytes32(0),
            status: 1
        });
        bytes32 configId = keccak256(
            abi.encode(
                keccak256("TICKERGARDEN_V1_STOCK_QUOTE_ECONOMICS"),
                uint256(1),
                block.chainid,
                config.tickerGardenBaselineId,
                config.quoteAsset,
                config.quoteDecimals,
                config.phantomQuote,
                config.graduationThreshold,
                binding.assetUid,
                binding.stockTokenFingerprintHash,
                binding.referenceEvidenceHash,
                binding.generatorPolicyId
            )
        );
        config.economicsHash = configId;
        quoteRegistry.addStockQuoteConfig(configId, config, binding);

        assertTrue(quoteRegistry.quoteIdentityCurrent(configId), "real Stock Quote identity");
        assertEq(quoteRegistry.quoteRuntimeCodeHash(configId), CRM_TOKEN_CODEHASH, "real Stock Quote codehash");
        StockQuoteBinding memory stored = quoteRegistry.stockQuoteBinding(configId);
        assertEq(keccak256(abi.encode(stored)), keccak256(abi.encode(binding)), "real Stock Quote binding");
    }
}
