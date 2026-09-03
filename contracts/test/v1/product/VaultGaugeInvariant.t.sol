// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";

import {AssetView, GaugeIdentity, MarketView, PositionView} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {AllocationManager} from "../../../src/v1/modules/AllocationManager.sol";
import {MemeStockGauge} from "../../../src/v1/modules/MemeStockGauge.sol";
import {MemeStockGaugeClone} from "../../../src/v1/shared/MemeStockGaugeClone.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {UserStockVaultExits} from "../../../src/v1/shared/UserStockVaultExits.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract InvariantOfficialStockRegistry {
    mapping(bytes32 assetUid => AssetView value) private _assets;
    mapping(bytes32 assetUid => uint256 minimum) private _minimumAllocations;

    function configure(bytes32 assetUid, address token, address vault, uint8 decimals, uint8 status, uint256 minimum)
        external
    {
        _assets[assetUid] = AssetView(token, vault, decimals, status);
        _minimumAllocations[assetUid] = minimum;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }

    /// @dev Test fixture default: identity is stable for invariant setup.
    function assetIdentityCurrent(bytes32) external pure returns (bool) {
        return true;
    }

    function minimumAllocation(bytes32 assetUid) external view returns (uint256) {
        return _minimumAllocations[assetUid];
    }
}

contract InvariantMarketRegistry {
    mapping(bytes32 marketId => MarketView value) private _markets;

    function configure(bytes32 marketId, bytes32 assetUid, address gauge) external {
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].runtime.launchPhase = 2;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract InvariantFeeVault {
    bytes32 public lastMarketId;
    address public lastUser;
    uint256 public recordedQuoteForfeiture;
    uint256 public recordedMemeForfeiture;
    bool public recordForfeitureShouldRevert;
    bool public recordForfeitureShouldConsumeAllGas;
    bool public reenterFlushOnce;

    error InjectedForfeitureFailure();

    function credit(MemeStockGauge gauge, address feeAsset, uint256 amount, bytes32 feeId) external {
        gauge.creditStakerFee(feeAsset, amount, feeId);
    }

    function setRecordForfeitureShouldRevert(bool value) external {
        recordForfeitureShouldRevert = value;
    }

    function setRecordForfeitureShouldConsumeAllGas(bool value) external {
        recordForfeitureShouldConsumeAllGas = value;
    }

    function setReenterFlushOnce(bool value) external {
        reenterFlushOnce = value;
    }

    function recordForfeiture(bytes32 marketId, address user, uint256 quoteAmount, uint256 memeAmount) external {
        if (recordForfeitureShouldConsumeAllGas) {
            assembly ("memory-safe") {
                invalid()
            }
        }
        if (recordForfeitureShouldRevert) revert InjectedForfeitureFailure();
        if (reenterFlushOnce) {
            reenterFlushOnce = false;
            MemeStockGauge(msg.sender).flushDeferredForfeiture();
        }
        lastMarketId = marketId;
        lastUser = user;
        recordedQuoteForfeiture += quoteAmount;
        recordedMemeForfeiture += memeAmount;
    }
}

contract VaultGaugeInvariantHandler is Test {
    bytes32 internal constant ASSET_UID = keccak256("invariant-stock");
    uint256 internal constant MINIMUM_POSITION = 0.5 ether;
    uint256 internal constant MAX_ACTION_AMOUNT = 10_000 ether;

    MockExactQuoteToken public immutable stock;
    UserStockVault public immutable vault;
    AllocationManager public immutable manager;
    MemeStockGauge public immutable gaugeA;
    MemeStockGauge public immutable gaugeB;
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
        bytes32 marketA_,
        bytes32 marketB_
    ) {
        stock = stock_;
        vault = vault_;
        manager = manager_;
        gaugeA = gaugeA_;
        gaugeB = gaugeB_;
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

    function close(uint8 userSeed, uint8 marketSeed) external {
        address user = _user(userSeed);
        bytes32 marketId = _market(marketSeed);
        MemeStockGauge gauge = _gauge(marketSeed);
        uint256 current = vault.allocation(ASSET_UID, user, marketId);
        if (current == 0) return;
        PositionView memory position = gauge.positionOf(user);
        if (block.timestamp < position.unlockAt) return;

        vm.prank(user);
        manager.closeAllocation(marketId);
    }

    function rageQuit(uint8 userSeed, uint8 marketSeed) external {
        address user = _user(userSeed);
        bytes32 marketId = _market(marketSeed);
        if (vault.allocation(ASSET_UID, user, marketId) == 0) return;
        vm.prank(user);
        manager.rageQuit(marketId);
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
}

contract VaultGaugeInvariantTest is StdInvariant, Test {
    bytes32 internal constant ASSET_UID = keccak256("invariant-stock");
    uint256 internal constant MINIMUM_POSITION = 0.5 ether;
    bytes32 internal constant MARKET_A = keccak256("invariant-market-a");
    bytes32 internal constant MARKET_B = keccak256("invariant-market-b");
    bytes32 internal constant QUOTE_A = keccak256("invariant-quote-a");
    bytes32 internal constant QUOTE_B = keccak256("invariant-quote-b");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    InvariantOfficialStockRegistry internal stockRegistry;
    InvariantMarketRegistry internal marketRegistry;
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
        stockRegistry.configure(ASSET_UID, address(stock), address(vault), 18, 1, MINIMUM_POSITION);
        marketRegistry.configure(MARKET_A, ASSET_UID, address(gaugeA));
        marketRegistry.configure(MARKET_B, ASSET_UID, address(gaugeB));

        handler = new VaultGaugeInvariantHandler(stock, vault, manager, gaugeA, gaugeB, MARKET_A, MARKET_B);
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.depositAndAllocate.selector;
        selectors[2] = handler.allocate.selector;
        selectors[3] = handler.elapse.selector;
        selectors[4] = handler.withdraw.selector;
        selectors[5] = handler.close.selector;
        selectors[6] = handler.rageQuit.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function test_rageQuitBeforeActivationReturnsAllPrincipalWithoutChangingMarket() public {
        _depositAndAllocate(ALICE, MINIMUM_POSITION);

        PositionView memory pending = gaugeA.positionOf(ALICE);
        assertEq(pending.activeAmount, 0);
        assertEq(pending.pendingAmount, MINIMUM_POSITION);

        vm.prank(ALICE);
        manager.rageQuit(MARKET_A);

        PositionView memory exited = gaugeA.positionOf(ALICE);
        assertEq(exited.activeAmount, 0);
        assertEq(exited.pendingAmount, 0);
        assertEq(exited.unlockAt, 0);
        assertEq(gaugeA.totalPendingStock(), 0);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(stock.balanceOf(ALICE), MINIMUM_POSITION);
        assertEq(feeVault.recordedQuoteForfeiture(), 0);
        assertEq(feeVault.recordedMemeForfeiture(), 0);
    }

    function test_rageQuitRedistributesToRemainingActiveThenLastExitReservesForPlatform() public {
        _depositAndAllocate(ALICE, 1 ether);
        _depositAndAllocate(BOB, 1 ether);

        vm.warp(block.timestamp + 31);
        vm.roll(block.number + 1);
        feeVault.credit(gaugeA, address(quote), 400, keccak256("QUOTE-FEE-1"));
        feeVault.credit(gaugeA, address(memeA), 600, keccak256("MEME-FEE-1"));

        assertEq(gaugeA.positionOf(ALICE).quoteClaimable, 200);
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 200);
        assertEq(gaugeA.positionOf(ALICE).memeClaimable, 300);
        assertEq(gaugeA.positionOf(BOB).memeClaimable, 300);

        vm.prank(ALICE);
        manager.rageQuit(MARKET_A);

        assertEq(stock.balanceOf(ALICE), 1 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(gaugeA.positionOf(ALICE).quoteClaimable, 0);
        assertEq(gaugeA.positionOf(ALICE).memeClaimable, 0);
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 400);
        assertEq(gaugeA.positionOf(BOB).memeClaimable, 600);
        assertEq(gaugeA.storedTotalActiveStock(), 1 ether);
        assertEq(feeVault.recordedQuoteForfeiture(), 0);
        assertEq(feeVault.recordedMemeForfeiture(), 0);

        vm.prank(BOB);
        manager.rageQuit(MARKET_A);

        assertEq(stock.balanceOf(BOB), 1 ether);
        assertEq(vault.deposited(ASSET_UID, BOB), 0);
        assertEq(vault.marketAllocated(ASSET_UID, MARKET_A), 0);
        assertEq(gaugeA.storedTotalActiveStock(), 0);
        assertEq(feeVault.lastMarketId(), MARKET_A);
        assertEq(feeVault.lastUser(), BOB);
        assertEq(feeVault.recordedQuoteForfeiture(), 400);
        assertEq(feeVault.recordedMemeForfeiture(), 600);
    }

    function test_rageQuitReturnsPrincipalWhenForfeitureReserveFailsAndFlushesOnce() public {
        _depositAndAllocate(ALICE, 1 ether);
        vm.warp(block.timestamp + 31);
        vm.roll(block.number + 1);
        feeVault.credit(gaugeA, address(quote), 100, keccak256("ROLLBACK-FEEVAULT"));
        feeVault.setRecordForfeitureShouldRevert(true);

        vm.prank(ALICE);
        manager.rageQuit(MARKET_A);

        // A reserve-accounting failure must not hold the user's principal hostage.
        assertEq(stock.balanceOf(ALICE), 1 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(gaugeA.positionOf(ALICE).activeAmount, 0);
        assertEq(gaugeA.positionOf(ALICE).pendingAmount, 0);
        assertEq(gaugeA.storedTotalActiveStock(), 0);
        assertEq(feeVault.recordedQuoteForfeiture(), 0);
        assertEq(feeVault.recordedMemeForfeiture(), 0);
        (uint256 deferredQuote, uint256 deferredMeme) = gaugeA.deferredForfeiture();
        assertEq(deferredQuote, 100);
        assertEq(deferredMeme, 0);

        // The deferred amount can be retried by any caller once the FeeVault recovers.
        feeVault.setRecordForfeitureShouldRevert(false);
        feeVault.setReenterFlushOnce(true);
        gaugeA.flushDeferredForfeiture();
        assertEq(feeVault.recordedQuoteForfeiture(), 100);
        assertEq(feeVault.recordedMemeForfeiture(), 0);
        (deferredQuote, deferredMeme) = gaugeA.deferredForfeiture();
        assertEq(deferredQuote, 0);
        assertEq(deferredMeme, 0);

        // A subsequent flush must not record the same forfeiture twice.
        gaugeA.flushDeferredForfeiture();
        assertEq(feeVault.recordedQuoteForfeiture(), 100);
        assertEq(feeVault.recordedMemeForfeiture(), 0);
    }

    function test_rageQuitPrincipalSurvivesRewardAccountingGasExhaustion() public {
        _depositAndAllocate(ALICE, 1 ether);
        vm.warp(block.timestamp + 31);
        vm.roll(block.number + 1);
        feeVault.credit(gaugeA, address(quote), 100, keccak256("GAS-BURN-FEEVAULT"));
        feeVault.setRecordForfeitureShouldConsumeAllGas(true);

        vm.prank(ALICE);
        manager.rageQuit(MARKET_A);

        assertEq(stock.balanceOf(ALICE), 1 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(gaugeA.positionOf(ALICE).activeAmount, 0);
        (uint256 deferredQuote, uint256 deferredMeme) = gaugeA.deferredForfeiture();
        assertEq(deferredQuote, 100);
        assertEq(deferredMeme, 0);
    }

    function test_removedMarketInterventionSelectorsCannotBlockPrincipalOrRewardCleanup() public {
        _depositAndAllocate(ALICE, 1 ether);
        (bool registryIntervention,) = address(marketRegistry)
            .call(abi.encodeWithSignature("setMarketPaused(bytes32,bytes32)", MARKET_A, bytes32("LEGACY")));
        (bool gaugeIntervention,) = address(gaugeA)
            .call(
                abi.encodeWithSignature(
                    "disableForEmergency(uint32,uint64,bytes32)", uint32(1), uint64(block.number), bytes32("LEGACY")
                )
            );
        assertFalse(registryIntervention);
        assertFalse(gaugeIntervention);
        uint256 userBalanceBefore = stock.balanceOf(ALICE);

        vm.prank(ALICE);
        manager.rageQuit(MARKET_A);

        assertEq(stock.balanceOf(ALICE) - userBalanceBefore, 1 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 0);

        assertEq(_gaugePosition(gaugeA, ALICE), 0);
        assertEq(gaugeA.totalPendingStock(), 0);
        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(feeVault.recordedQuoteForfeiture(), 0);
        assertEq(feeVault.recordedMemeForfeiture(), 0);
    }

    function test_gaugeFailureCannotBlockPrincipalAndPermissionlessRetryCompletesForfeiture() public {
        _depositAndAllocate(ALICE, 1 ether);
        _depositAndAllocate(BOB, 1 ether);
        vm.warp(block.timestamp + 31);
        vm.roll(block.number + 1);
        feeVault.credit(gaugeA, address(quote), 400, keccak256("GAUGE-FAILURE-QUOTE"));

        vm.mockCallRevert(
            address(gaugeA), abi.encodeCall(MemeStockGauge.rageQuit, (ALICE)), bytes("INJECTED_GAUGE_FAILURE")
        );
        vm.prank(ALICE);
        manager.rageQuit(MARKET_A);

        // Principal completion is authoritative even though the reward side is
        // still present in the Gauge.
        assertEq(stock.balanceOf(ALICE), 1 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_A), 1 ether);
        assertEq(_gaugePosition(gaugeA, ALICE), 1 ether);

        vm.expectRevert(
            abi.encodeWithSelector(MemeStockGauge.RageQuitRewardSettlementPending.selector, ALICE, MARKET_A, 1 ether)
        );
        vm.prank(address(feeVault));
        gaugeA.settle(ALICE);

        vm.clearMockedCalls();
        manager.settleRageQuitRewards(MARKET_A, ALICE);

        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(_gaugePosition(gaugeA, ALICE), 0);
        assertEq(gaugeA.positionOf(ALICE).quoteClaimable, 0);
        assertEq(gaugeA.positionOf(BOB).quoteClaimable, 400);
        assertEq(stock.balanceOf(BOB), 0);
        assertEq(vault.allocation(ASSET_UID, BOB, MARKET_A), 1 ether);
    }

    function test_directVaultEscapeReturnsPrincipalBeforePermissionlessRewardCleanup() public {
        _depositAndAllocate(ALICE, 1 ether);
        vm.warp(block.timestamp + 31);
        vm.roll(block.number + 1);
        feeVault.credit(gaugeA, address(quote), 100, keccak256("DIRECT-VAULT-ESCAPE"));

        vm.prank(ALICE);
        vault.rageQuit(ASSET_UID, MARKET_A);

        assertEq(stock.balanceOf(ALICE), 1 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_A), 1 ether);
        assertEq(_gaugePosition(gaugeA, ALICE), 1 ether);

        vm.prank(BOB);
        manager.settleRageQuitRewards(MARKET_A, ALICE);

        assertEq(vault.rageQuitSettlementPrincipal(ASSET_UID, ALICE, MARKET_A), 0);
        assertEq(_gaugePosition(gaugeA, ALICE), 0);
        assertEq(feeVault.recordedQuoteForfeiture(), 100);
    }

    function test_rageQuitRollsBackGaugeReserveAndVaultWhenPrincipalTransferFails() public {
        _depositAndAllocate(ALICE, 1 ether);
        vm.warp(block.timestamp + 31);
        vm.roll(block.number + 1);
        feeVault.credit(gaugeA, address(quote), 100, keccak256("ROLLBACK-TRANSFER"));
        vm.mockCallRevert(
            address(stock), abi.encodeWithSignature("transfer(address,uint256)", ALICE, 1 ether), bytes("TRANSFER_FAIL")
        );

        vm.expectRevert(abi.encodeWithSelector(UserStockVaultExits.StockWithdrawalCallFailed.selector, address(stock)));
        vm.prank(ALICE);
        manager.rageQuit(MARKET_A);

        _assertAlicePositionUnchangedAfterFailedRageQuit(100);
        assertEq(feeVault.recordedQuoteForfeiture(), 0);
        assertEq(feeVault.recordedMemeForfeiture(), 0);
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
            assertEq(_gaugePosition(gaugeA, user), allocationA);
            assertEq(_gaugePosition(gaugeB, user), allocationB);
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
        assertEq(
            gaugeA.storedTotalActiveStock() + gaugeA.totalPendingStock(), vault.marketAllocated(ASSET_UID, MARKET_A)
        );
        assertEq(
            gaugeB.storedTotalActiveStock() + gaugeB.totalPendingStock(), vault.marketAllocated(ASSET_UID, MARKET_B)
        );
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
                    quoteAsset: address(quote),
                    memeToken: meme
                })
            )
        );
    }

    function _depositAndAllocate(address user, uint256 amount) private {
        stock.mint(user, amount);
        vm.startPrank(user);
        stock.approve(address(vault), amount);
        manager.depositAndAllocate(MARKET_A, amount, amount);
        vm.stopPrank();
    }

    function _assertAlicePositionUnchangedAfterFailedRageQuit(uint256 quoteClaimable) private view {
        PositionView memory position = gaugeA.positionOf(ALICE);
        assertEq(position.activeAmount + position.pendingAmount, 1 ether);
        assertEq(position.quoteClaimable, quoteClaimable);
        assertEq(gaugeA.storedTotalActiveStock(), 1 ether);
        assertEq(vault.deposited(ASSET_UID, ALICE), 1 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_A), 1 ether);
        assertEq(stock.balanceOf(ALICE), 0);
        assertEq(stock.balanceOf(address(vault)), 1 ether);
    }

    function _gaugePosition(MemeStockGauge gauge, address user) private view returns (uint256) {
        PositionView memory position = gauge.positionOf(user);
        return position.activeAmount + position.pendingAmount;
    }
}
