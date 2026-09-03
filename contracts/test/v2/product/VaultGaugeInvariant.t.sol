// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {AssetView, GaugeIdentity, MarketView, PositionView} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {AllocationManager} from "../../../src/v2/modules/AllocationManager.sol";
import {MemeStockGauge} from "../../../src/v2/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v2/shared/MemeStockGaugeClone.sol";
import {UserStockVault} from "../../../src/v2/modules/UserStockVault.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract InvariantOfficialStockRegistry {
    mapping(bytes32 assetUid => AssetView value) private _assets;

    function configure(bytes32 assetUid, address token, address vault, uint8 decimals, uint8 status) external {
        _assets[assetUid] = AssetView(token, vault, decimals, status);
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }
}

contract InvariantMarketRegistry {
    mapping(bytes32 marketId => MarketView value) private _markets;

    function configure(bytes32 marketId, bytes32 assetUid, address gauge) external {
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].runtime.launchPhase = 2;
        _markets[marketId].runtime.marketStatus = 0;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }

    function activateEmergency(bytes32 marketId) external {
        _markets[marketId].runtime.marketStatus = 3;
        _markets[marketId].runtime.recoveryEpoch = 1;
    }

    function setMarketStatus(bytes32 marketId, uint8 status) external {
        _markets[marketId].runtime.marketStatus = status;
    }

    function marketStatus(bytes32 marketId) external view returns (uint8) {
        return _markets[marketId].runtime.marketStatus;
    }
}

contract InvariantMarketController {
    function isStockAllocationOpen(bytes32) external pure returns (bool) {
        return true;
    }

    function disable(MemeStockGauge gauge, bytes32 marketId) external {
        gauge.disableForEmergency(1, uint64(block.number - 1), keccak256(abi.encode("INVARIANT-EMERGENCY", marketId)));
    }
}

contract InvariantFeeVault {}

contract VaultGaugeInvariantHandler is Test {
    bytes32 internal constant ASSET_UID = keccak256("invariant-stock");
    uint256 internal constant MINIMUM_POSITION = 0.5 ether + 1;
    uint256 internal constant MAX_ACTION_AMOUNT = 10_000 ether;

    MockExactQuoteToken public immutable stock;
    UserStockVault public immutable vault;
    AllocationManager public immutable manager;
    MemeStockGauge public immutable gaugeA;
    MemeStockGauge public immutable gaugeB;
    InvariantMarketRegistry public immutable marketRegistry;
    InvariantMarketController public immutable controller;
    bytes32 public immutable marketA;
    bytes32 public immutable marketB;

    address[4] private _users;
    uint256 public totalMinted;

    constructor(
        MockExactQuoteToken stock_,
        UserStockVault vault_,
        AllocationManager manager_,
        MemeStockGauge gaugeA_,
        MemeStockGauge gaugeB_,
        InvariantMarketRegistry marketRegistry_,
        InvariantMarketController controller_,
        bytes32 marketA_,
        bytes32 marketB_
    ) {
        stock = stock_;
        vault = vault_;
        manager = manager_;
        gaugeA = gaugeA_;
        gaugeB = gaugeB_;
        marketRegistry = marketRegistry_;
        controller = controller_;
        marketA = marketA_;
        marketB = marketB_;
        _users = [address(0xA11CE), address(0xB0B), address(0xCAFE), address(0xD00D)];
    }

    function userAt(uint256 index) external view returns (address) {
        return _users[index];
    }

    function deposit(uint8 userSeed, uint96 rawAmount) external {
        address user = _user(userSeed);
        uint256 amount = bound(uint256(rawAmount), 1, MAX_ACTION_AMOUNT);
        stock.mint(user, amount);
        totalMinted += amount;
        vm.startPrank(user);
        stock.approve(address(vault), amount);
        vault.depositStock(ASSET_UID, amount);
        vm.stopPrank();
    }

    function depositAndAllocate(uint8 userSeed, uint8 marketSeed, uint96 rawDeposit, uint96 rawAllocation) external {
        bytes32 marketId = _market(marketSeed);
        if (!_isActive(marketId)) return;
        address user = _user(userSeed);
        uint256 depositAmount = bound(uint256(rawDeposit), MINIMUM_POSITION, MAX_ACTION_AMOUNT);
        uint256 allocationAmount = bound(uint256(rawAllocation), MINIMUM_POSITION, depositAmount);
        stock.mint(user, depositAmount);
        totalMinted += depositAmount;
        vm.startPrank(user);
        stock.approve(address(vault), depositAmount);
        manager.depositAndAllocate(marketId, depositAmount, allocationAmount);
        vm.stopPrank();
    }

    function allocate(uint8 userSeed, uint8 marketSeed, uint96 rawAmount) external {
        address user = _user(userSeed);
        bytes32 marketId = _market(marketSeed);
        if (!_isActive(marketId)) return;
        uint256 free = vault.freeBalanceOf(ASSET_UID, user);
        uint256 current = vault.allocation(ASSET_UID, user, marketId);
        uint256 minimumAmount = current == 0 ? MINIMUM_POSITION : 1;
        if (free < minimumAmount) return;
        uint256 amount = bound(uint256(rawAmount), minimumAmount, free);
        vm.prank(user);
        manager.allocate(marketId, amount);
    }

    function elapse(uint32 rawSeconds) external {
        uint256 elapsed = bound(uint256(rawSeconds), 1, 2 days);
        vm.warp(block.timestamp + elapsed);
        vm.roll(block.number + 1);
    }

    function withdraw(uint8 userSeed, uint96 rawAmount) external {
        address user = _user(userSeed);
        uint256 free = vault.freeBalanceOf(ASSET_UID, user);
        if (free == 0) return;
        uint256 amount = bound(uint256(rawAmount), 1, free);
        vm.prank(user);
        vault.withdrawFreeStock(ASSET_UID, amount);
    }

    function decrease(uint8 userSeed, uint8 marketSeed, uint96 rawAmount, bool closePosition) external {
        address user = _user(userSeed);
        bytes32 marketId = _market(marketSeed);
        MemeStockGauge gauge = _gauge(marketSeed);
        if (_isEmergency(marketId)) return;
        uint256 current = vault.allocation(ASSET_UID, user, marketId);
        if (current == 0) return;
        PositionView memory position = gauge.positionOf(user);
        if (block.timestamp < position.unlockAt) return;

        vm.prank(user);
        if (closePosition || current <= MINIMUM_POSITION) {
            manager.closeAllocation(marketId);
        } else {
            uint256 amount = bound(uint256(rawAmount), 1, current - MINIMUM_POSITION);
            manager.decreaseAllocation(marketId, amount);
        }
    }

    function migrate(uint8 userSeed, bool fromA, uint96 rawAmount) external {
        address user = _user(userSeed);
        bytes32 sourceMarket = fromA ? marketA : marketB;
        bytes32 targetMarket = fromA ? marketB : marketA;
        if (_isEmergency(sourceMarket) || !_isActive(targetMarket)) return;
        MemeStockGauge sourceGauge = fromA ? gaugeA : gaugeB;
        uint256 source = vault.allocation(ASSET_UID, user, sourceMarket);
        if (source < MINIMUM_POSITION) return;
        PositionView memory position = sourceGauge.positionOf(user);
        if (block.timestamp < position.unlockAt) return;
        if (position.pendingAmount != 0 && position.pendingGeneration > block.timestamp) return;

        uint256 amount;
        if (source < MINIMUM_POSITION * 2) {
            amount = source;
        } else {
            amount = bound(uint256(rawAmount), MINIMUM_POSITION, source - MINIMUM_POSITION);
        }
        vm.prank(user);
        manager.migrateAllocation(sourceMarket, targetMarket, amount);
    }

    function activateEmergency(uint8 marketSeed) external {
        bytes32 marketId = _market(marketSeed);
        if (_isEmergency(marketId)) return;
        controller.disable(_gauge(marketSeed), marketId);
        marketRegistry.activateEmergency(marketId);
    }

    function pauseMarket(uint8 marketSeed) external {
        bytes32 marketId = _market(marketSeed);
        if (_isActive(marketId)) marketRegistry.setMarketStatus(marketId, 1);
    }

    function reactivateMarket(uint8 marketSeed) external {
        bytes32 marketId = _market(marketSeed);
        if (marketRegistry.marketStatus(marketId) == 1) marketRegistry.setMarketStatus(marketId, 0);
    }

    function retireMarket(uint8 marketSeed) external {
        bytes32 marketId = _market(marketSeed);
        uint8 status = marketRegistry.marketStatus(marketId);
        if (status <= 1) marketRegistry.setMarketStatus(marketId, 2);
    }

    function forceRelease(uint8 userSeed, uint8 marketSeed) external {
        address user = _user(userSeed);
        bytes32 marketId = _market(marketSeed);
        if (!_isEmergency(marketId) || vault.allocation(ASSET_UID, user, marketId) == 0) return;
        vm.prank(user);
        vault.forceReleaseAllocation(ASSET_UID, marketId);
    }

    function _user(uint8 seed) private view returns (address) {
        return _users[uint256(seed) % _users.length];
    }

    function _market(uint8 seed) private view returns (bytes32) {
        return seed % 2 == 0 ? marketA : marketB;
    }

    function _gauge(uint8 seed) private view returns (MemeStockGauge) {
        return seed % 2 == 0 ? gaugeA : gaugeB;
    }

    function _isEmergency(bytes32 marketId) private view returns (bool) {
        return marketRegistry.marketStatus(marketId) == 3;
    }

    function _isActive(bytes32 marketId) private view returns (bool) {
        return marketRegistry.marketStatus(marketId) == 0;
    }
}

contract VaultGaugeInvariantTest is StdInvariant, Test {
    bytes32 internal constant ASSET_UID = keccak256("invariant-stock");
    bytes32 internal constant MARKET_A = keccak256("invariant-market-a");
    bytes32 internal constant MARKET_B = keccak256("invariant-market-b");
    bytes32 internal constant QUOTE_A = keccak256("invariant-quote-a");
    bytes32 internal constant QUOTE_B = keccak256("invariant-quote-b");

    InvariantOfficialStockRegistry internal stockRegistry;
    InvariantMarketRegistry internal marketRegistry;
    InvariantMarketController internal controller;
    InvariantFeeVault internal feeVault;
    MockExactQuoteToken internal stock;
    MockExactQuoteToken internal quote;
    MockExactQuoteToken internal memeA;
    MockExactQuoteToken internal memeB;
    AllocationManager internal manager;
    UserStockVault internal vault;
    MemeStockGauge internal gaugeA;
    MemeStockGauge internal gaugeB;
    MemeStockGauge internal gaugeImplementation;
    VaultGaugeInvariantHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(100);
        stockRegistry = new InvariantOfficialStockRegistry();
        marketRegistry = new InvariantMarketRegistry();
        controller = new InvariantMarketController();
        feeVault = new InvariantFeeVault();
        stock = new MockExactQuoteToken(18);
        quote = new MockExactQuoteToken(6);
        memeA = new MockExactQuoteToken(18);
        memeB = new MockExactQuoteToken(18);
        manager = new AllocationManager(address(stockRegistry), address(marketRegistry));
        gaugeImplementation = new MemeStockGauge();
        vault = new UserStockVault(address(stockRegistry), address(marketRegistry), address(manager));
        gaugeA = _deployGauge(MARKET_A, QUOTE_A, address(memeA));
        gaugeB = _deployGauge(MARKET_B, QUOTE_B, address(memeB));
        stockRegistry.configure(ASSET_UID, address(stock), address(vault), 18, 1);
        marketRegistry.configure(MARKET_A, ASSET_UID, address(gaugeA));
        marketRegistry.configure(MARKET_B, ASSET_UID, address(gaugeB));

        handler = new VaultGaugeInvariantHandler(
            stock, vault, manager, gaugeA, gaugeB, marketRegistry, controller, MARKET_A, MARKET_B
        );
        bytes4[] memory selectors = new bytes4[](12);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.depositAndAllocate.selector;
        selectors[2] = handler.allocate.selector;
        selectors[3] = handler.elapse.selector;
        selectors[4] = handler.withdraw.selector;
        selectors[5] = handler.decrease.selector;
        selectors[6] = handler.migrate.selector;
        selectors[7] = handler.activateEmergency.selector;
        selectors[8] = handler.forceRelease.selector;
        selectors[9] = handler.pauseMarket.selector;
        selectors[10] = handler.reactivateMarket.selector;
        selectors[11] = handler.retireMarket.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_principalAndThreeLevelAllocationLedgersRemainEqual() public view {
        uint256 userDeposited;
        uint256 userAllocated;
        uint256 marketAAllocated;
        uint256 marketBAllocated;
        uint256 userTokenBalances;

        for (uint256 i; i < 4; ++i) {
            address user = handler.userAt(i);
            uint256 deposited = vault.deposited(ASSET_UID, user);
            uint256 allocated = vault.allocated(ASSET_UID, user);
            uint256 allocationA = vault.allocation(ASSET_UID, user, MARKET_A);
            uint256 allocationB = vault.allocation(ASSET_UID, user, MARKET_B);
            assertEq(deposited, vault.freeBalanceOf(ASSET_UID, user) + allocated);
            assertEq(allocated, allocationA + allocationB);
            if (marketRegistry.marketStatus(MARKET_A) != 3) assertEq(_gaugePosition(gaugeA, user), allocationA);
            if (marketRegistry.marketStatus(MARKET_B) != 3) assertEq(_gaugePosition(gaugeB, user), allocationB);
            userDeposited += deposited;
            userAllocated += allocated;
            marketAAllocated += allocationA;
            marketBAllocated += allocationB;
            userTokenBalances += stock.balanceOf(user);
        }

        assertEq(vault.totalDeposited(ASSET_UID), userDeposited);
        assertEq(vault.totalAllocated(ASSET_UID), userAllocated);
        assertEq(vault.marketAllocated(ASSET_UID, MARKET_A), marketAAllocated);
        assertEq(vault.marketAllocated(ASSET_UID, MARKET_B), marketBAllocated);
        assertEq(userAllocated, marketAAllocated + marketBAllocated);
        assertEq(stock.balanceOf(address(vault)), vault.totalDeposited(ASSET_UID));
        assertEq(stock.balanceOf(address(vault)) + userTokenBalances, handler.totalMinted());
    }

    function invariant_gaugeWeightMatchesMarketPrincipalAndNeverCustodiesStock() public view {
        if (marketRegistry.marketStatus(MARKET_A) != 3) {
            assertEq(
                gaugeA.storedTotalActiveStock() + gaugeA.totalPendingStock(), vault.marketAllocated(ASSET_UID, MARKET_A)
            );
        }
        if (marketRegistry.marketStatus(MARKET_B) != 3) {
            assertEq(
                gaugeB.storedTotalActiveStock() + gaugeB.totalPendingStock(), vault.marketAllocated(ASSET_UID, MARKET_B)
            );
        }
        assertEq(stock.balanceOf(address(gaugeA)), 0);
        assertEq(stock.balanceOf(address(gaugeB)), 0);
        assertEq(stock.balanceOf(address(manager)), 0);
        assertEq(stock.balanceOf(address(handler)), 0);
    }

    function _deployGauge(bytes32 marketId, bytes32 quoteId, address meme) private returns (MemeStockGauge) {
        return MemeStockGauge(
            MemeStockGaugeClone.deployDeterministic(
                address(gaugeImplementation),
                marketId,
                GaugeIdentity({
                    marketId: marketId,
                    assetUid: ASSET_UID,
                    quoteAssetConfigId: quoteId,
                    allocationManager: address(manager),
                    protocolFeeVault: address(feeVault),
                    marketController: address(controller),
                    quoteAsset: address(quote),
                    memeToken: meme
                })
            )
        );
    }

    function _gaugePosition(MemeStockGauge gauge, address user) private view returns (uint256) {
        PositionView memory position = gauge.positionOf(user);
        return position.activeAmount + position.pendingAmount;
    }
}
