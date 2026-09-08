// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {R5DeployedBusinessTimeGatesTest} from "./R5DeployedBusinessTimeGates.t.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey as V4PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {
    CreateMarketParams,
    MarketView,
    PoolKey,
    ConversionItem,
    PositionView
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {TickerGardenFactoryV1} from "../../../src/v1/modules/TickerGardenFactoryV1.sol";
import {LaunchAndBuyRouter} from "../../../src/v1/modules/LaunchAndBuyRouter.sol";
import {TickerGardenCurve} from "../../../src/v1/modules/TickerGardenCurve.sol";
import {MarketRegistryV1} from "../../../src/v1/modules/MarketRegistryV1.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";

/// @notice Full 16-way business matrix on a local fork of the actual R5 deployment.
/// @dev Funded with vm.deal only locally; synthetic test stock/quote, no public-chain writes.
contract R5DeployedBusinessMatrixTest is R5DeployedBusinessTimeGatesTest {
    bool nativeQuote;
    bool staking;
    bool sharing;
    uint16 tax;
    address buyer;
    address second;
    address quote;
    address stock;
    address token;
    bytes32 id;
    uint256 amount;
    TickerGardenFactoryV1 factory;
    LaunchAndBuyRouter router;
    MarketRegistryV1 registry;
    MarketView m;
    TickerGardenCurve curve;
    PoolSwapTest helper;

    function _matrix(bool n, bool st, bool sh, uint16 t) internal {
        nativeQuote = n;
        staking = st;
        sharing = sh;
        tax = t;
        _launchCase();
        _curveCase();
        _graduateCase();
        _settleCase();
    }

    function _launchCase() internal {
        vm.warp(vm.parseJsonUint(f, ".unpauseAt"));
        vm.prank(admin);
        stocks.unpauseAsset(vm.parseJsonBytes32(f, ".stockUid"));
        buyer = vm.parseJsonAddress(f, ".roles.buyer");
        second = vm.parseJsonAddress(f, ".roles.outsider");
        quote = nativeQuote ? address(0) : vm.parseJsonAddress(f, ".testQuote");
        stock = vm.parseJsonAddress(f, ".stock");
        vm.deal(creator, 10 ether);
        vm.deal(buyer, 10 ether);
        vm.startPrank(staker);
        IERC20(stock).transfer(second, 1000 ether);
        if (!nativeQuote) {
            IERC20(quote).transfer(creator, 1000 ether);
            IERC20(quote).transfer(buyer, 1000 ether);
        }
        vm.stopPrank();
        factory = TickerGardenFactoryV1(vm.parseJsonAddress(f, ".factory"));
        router = LaunchAndBuyRouter(payable(vm.parseJsonAddress(f, ".router")));
        CreateMarketParams memory params = CreateMarketParams({
            assetUid: staking ? vm.parseJsonBytes32(f, ".stockUid") : bytes32(0),
            tickerGardenBaselineId: vm.parseJsonBytes32(f, ".baselineId"),
            quoteAssetConfigId: vm.parseJsonBytes32(f, nativeQuote ? ".nativeQuoteId" : ".quoteId"),
            launchTemplateId: vm.parseJsonBytes32(f, ".templateId"),
            expectedEconomics: bytes32(0),
            creatorRevenueBeneficiary: creator,
            name: "R5 Local Business Matrix",
            symbol: "tgLOCAL",
            metadataURI: "data:application/json,%7B%7D",
            salt: keccak256(abi.encode("R5_LOCAL_MATRIX", nativeQuote, staking, sharing, tax)),
            creatorTaxBps: tax,
            creatorFeesToHolders: sharing,
            stakingEnabled: staking
        });
        params.expectedEconomics = factory.previewMarketEconomics(params);
        amount = nativeQuote ? 0.001 ether : 1 ether;
        vm.startPrank(creator);
        if (!nativeQuote) IERC20(quote).approve(address(router), amount);
        (id, token,,) = router.launchAndBuy{value: factory.launchFee() + (nativeQuote ? amount : 0)}(
            params, amount, 1, creator
        );
        vm.stopPrank();
        registry = MarketRegistryV1(vm.parseJsonAddress(f, ".registry"));
        m = registry.market(id);
        assertEq(m.config.stakingEnabled, staking);
        assertEq(m.config.gauge != address(0), staking);
        assertGt(IERC20(token).balanceOf(creator), 0);
        curve = TickerGardenCurve(payable(m.config.curve));
    }

    function _curveCase() internal {
        vm.warp(block.timestamp + 4);
        vm.startPrank(buyer);
        if (!nativeQuote) IERC20(quote).approve(address(curve), 1000 ether);
        curve.buy{value: nativeQuote ? amount : 0}(amount, 1, buyer);
        uint256 sell = IERC20(token).balanceOf(buyer) / 4;
        IERC20(token).approve(address(curve), sell);
        (uint256 soldOut, uint256 sellFees) = curve.sell(sell, 1, buyer);
        vm.stopPrank();
        uint256 base = amount / 100 * 2 + (soldOut + sellFees) / 100;
        uint256 creatorTax = amount * tax / 10000 * 2 + (soldOut + sellFees) * tax / 10000;
        curve.sweepCurveFees();
        uint256 platform = base * 3000 / 10000;
        uint256 creatorBase = base - platform;
        uint256 holder = sharing ? creatorBase / 2 : 0;
        assertEq(fees.creatorLiability(id, 1, quote), creatorBase - holder + creatorTax);
        assertEq(fees.liability(id, quote, 2), platform);
        assertEq(fees.holderLiability(id, 1, quote), holder);
        uint256 cb = _balance(quote, creator);
        uint256 pb = _balance(quote, fees.platformTreasury());
        fees.claimCreator(id, 1, quote);
        fees.claimPlatform(id, quote);
        assertEq(_balance(quote, creator) - cb, creatorBase - holder + creatorTax);
        assertEq(_balance(quote, fees.platformTreasury()) - pb, platform);
        assertEq(fees.claimCreator(id, 1, quote), 0);
        assertEq(fees.claimPlatform(id, quote), 0);
    }

    function _graduateCase() internal {
        vm.prank(buyer);
        curve.buy{value: nativeQuote ? 0.5 ether : 0}(nativeQuote ? 0.5 ether : 120 ether, 1, buyer);
        assertEq(registry.market(id).runtime.launchPhase, 1);
        helper = new PoolSwapTest(IPoolManager(vm.parseJsonAddress(f, ".poolManager")));
        _trade(registry, helper, id, quote, true, buyer, nativeQuote ? 0.001 ether : 1 ether);
        _trade(registry, helper, id, quote, false, buyer, IERC20(token).balanceOf(buyer) / 1000);
        if (staking) {
            address vault = vm.parseJsonAddress(f, ".stockVault");
            vm.startPrank(staker);
            IERC20(stock).approve(vault, 100 ether);
            manager.stake(id, 100 ether);
            vm.stopPrank();
            vm.startPrank(second);
            IERC20(stock).approve(vault, 300 ether);
            manager.stake(id, 300 ether);
            vm.stopPrank();
            MemeStockGauge g = MemeStockGauge(m.config.gauge);
            vm.warp(uint256(g.positionOf(second).pendingGeneration) + 1);
            g.checkpointActivations();
            _trade(registry, helper, id, quote, true, buyer, nativeQuote ? 0.001 ether : 1 ether);
            _trade(registry, helper, id, quote, false, buyer, IERC20(token).balanceOf(buyer) / 1000);
            PositionView memory a = g.positionOf(staker);
            PositionView memory b = g.positionOf(second);
            assertGt(a.memeClaimable, 0);
            assertGe(b.memeClaimable, a.memeClaimable * 3);
            assertLe(b.memeClaimable, a.memeClaimable * 3 + 2);
        }
    }

    function _settleCase() internal {
        uint256 h = fees.holderLiability(id, 1, token);
        ConversionItem[] memory items = new ConversionItem[](staking ? 2 : 1);
        items[0] = ConversionItem(creator, 1, fees.creatorLiability(id, 1, token));
        if (staking) items[1] = ConversionItem(
            staker, 0, MemeStockGauge(m.config.gauge).positionOf(staker).memeClaimable
        );
        {
            uint256 quoteBefore=fees.totalLiability(quote);uint256 memeBefore=fees.totalLiability(token);
            vm.recordLogs();vm.prank(admin);(uint256 spent,uint256 received)=fees.settleRewards(id,items,1,block.timestamp+240);
            assertEq(fees.totalLiability(quote)-quoteBefore,received);assertEq(memeBefore-fees.totalLiability(token),spent);
            Vm.Log[] memory logs=vm.getRecordedLogs();for(uint256 i;i<logs.length;i++)assertTrue(logs[i].topics[0]!=keccak256("V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)"),"conversion charged a trading fee");
        }
        assertEq(fees.holderLiability(id, 1, token), h);
        assertEq(fees.creatorLiability(id, 1, token), 0);
        fees.claimCreator(id, 1, quote);
        fees.claimPlatform(id, quote);
        fees.claimPlatform(id, token);
        if (sharing) {
            uint256 creatorQuote = fees.creatorLiability(id, 1, quote);
            vm.prank(admin);
            fees.settleHolderRewards(id, 1, h, 1, block.timestamp + 240);
            assertEq(fees.creatorLiability(id, 1, quote), creatorQuote);
            fees.fundHolderRewards(id, 1);
            assertGt(distributor.epochQuoteAmount(id, 1), 0);
        }
        if (staking) {
            MemeStockGauge g = MemeStockGauge(m.config.gauge);
            vm.warp(g.positionOf(staker).unlockAt);
            uint256 before = IERC20(stock).balanceOf(staker);
            vm.prank(staker);
            manager.unstakeAndWithdraw(id);
            assertEq(IERC20(stock).balanceOf(staker) - before, 100 ether);
            vm.prank(staker);
            assertGt(fees.claimStaker(id, quote), 0);
        }
        assertGe(_balance(quote, address(fees)), fees.totalLiability(quote));
        assertGe(IERC20(token).balanceOf(address(fees)), fees.totalLiability(token));
    }

    function _balance(address asset, address user) internal view returns (uint256) {
        return asset == address(0) ? user.balance : IERC20(asset).balanceOf(user);
    }

    struct FeeSnapshot {uint256 creator;uint256 staker;uint256 platform;uint256 holder;uint256 buyer;uint256 balance;uint256 active;}
    function _trade(MarketRegistryV1 r,PoolSwapTest swapper,bytes32 marketId,address quoteAsset,bool buy,address user,uint256 quantity) internal {
        PoolKey memory k=r.canonicalPoolKey(marketId);bool direction=buy?(k.currency0==quoteAsset):(k.currency0!=quoteAsset);
        address input=buy?quoteAsset:r.market(marketId).config.memeToken;address feeAsset=buy?token:quoteAsset;
        FeeSnapshot memory snap=FeeSnapshot(fees.creatorLiability(id,1,feeAsset),fees.liability(id,feeAsset,1),fees.liability(id,feeAsset,2),fees.holderLiability(id,1,feeAsset),_balance(feeAsset,user),_balance(feeAsset,address(fees)),staking?manager.rewardEligibleActiveStock(id):0);
        vm.startPrank(user);if(input!=address(0))IERC20(input).approve(address(swapper),quantity);vm.recordLogs();
        swapper.swap{value:input==address(0)?quantity:0}(V4PoolKey(Currency.wrap(k.currency0),Currency.wrap(k.currency1),k.fee,k.tickSpacing,IHooks(k.hooks)),SwapParams(direction,-int256(quantity),direction?4295128741:1461446703485210103287273052203988822378723970341),PoolSwapTest.TestSettings(false,false),"");
        vm.stopPrank();_assertV4Fees(vm.getRecordedLogs(),snap,feeAsset,user);
    }
    struct ExpectedFee {uint256 base;uint256 total;uint256 platform;uint256 staker;uint256 creator;uint256 holder;}
    function _assertV4Fees(Vm.Log[] memory logs,FeeSnapshot memory s,address asset,address user) internal view {
        bool found;
        for(uint256 i;i<logs.length;i++)if(logs[i].topics[0]==keccak256("V4FeeAccrued(bytes32,bytes32,address,uint64,bytes32,uint256,uint256,uint256,uint256)")){
            found=true;assertEq(address(uint160(uint256(logs[i].topics[3]))),asset);
            ExpectedFee memory e;(,,e.base,e.total,,)=abi.decode(logs[i].data,(uint64,bytes32,uint256,uint256,uint256,uint256));
            uint256 basic=e.base/100;e.platform=basic*3000/10000;e.staker=s.active>0?e.platform:0;e.creator=basic-e.platform-e.staker;e.holder=sharing?e.creator/2:0;e.creator=e.creator-e.holder+e.base*tax/10000;
            assertEq(e.total,basic+e.base*tax/10000);assertEq(_balance(asset,user)-s.buyer+e.total,e.base,"output independently binds fee base");
            assertEq(fees.creatorLiability(id,1,asset)-s.creator,e.creator);assertEq(fees.liability(id,asset,1)-s.staker,e.staker);assertEq(fees.liability(id,asset,2)-s.platform,e.platform);assertEq(fees.holderLiability(id,1,asset)-s.holder,e.holder);assertEq(_balance(asset,address(fees))-s.balance,e.total);
        }
        assertTrue(found,"missing actual hook fee");
    }

    function test_matrix_ETH_S0_H0_T0() public {
        _matrix(true, false, false, 0);
    }

    function test_matrix_ETH_S0_H0_T500() public {
        _matrix(true, false, false, 500);
    }

    function test_matrix_ETH_S0_H1_T0() public {
        _matrix(true, false, true, 0);
    }

    function test_matrix_ETH_S0_H1_T500() public {
        _matrix(true, false, true, 500);
    }

    function test_matrix_ETH_S1_H0_T0() public {
        _matrix(true, true, false, 0);
    }

    function test_matrix_ETH_S1_H0_T500() public {
        _matrix(true, true, false, 500);
    }

    function test_matrix_ETH_S1_H1_T0() public {
        _matrix(true, true, true, 0);
    }

    function test_matrix_ETH_S1_H1_T500() public {
        _matrix(true, true, true, 500);
    }

    function test_matrix_ERC20_S0_H0_T0() public {
        _matrix(false, false, false, 0);
    }

    function test_matrix_ERC20_S0_H0_T500() public {
        _matrix(false, false, false, 500);
    }

    function test_matrix_ERC20_S0_H1_T0() public {
        _matrix(false, false, true, 0);
    }

    function test_matrix_ERC20_S0_H1_T500() public {
        _matrix(false, false, true, 500);
    }

    function test_matrix_ERC20_S1_H0_T0() public {
        _matrix(false, true, false, 0);
    }

    function test_matrix_ERC20_S1_H0_T500() public {
        _matrix(false, true, false, 500);
    }

    function test_matrix_ERC20_S1_H1_T0() public {
        _matrix(false, true, true, 0);
    }

    function test_matrix_ERC20_S1_H1_T500() public {
        _matrix(false, true, true, 500);
    }
}
