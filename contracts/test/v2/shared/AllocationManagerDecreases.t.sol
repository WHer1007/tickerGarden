// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    AssetView,
    IAllocationManager,
    IUserStockVault,
    MarketView,
    PositionView
} from "../../../src/v2/interfaces/IV2Protocol.sol";
import {UserStockVault} from "../../../src/v2/modules/UserStockVault.sol";
import {AllocationManagerDecreases} from "../../../src/v2/shared/AllocationManagerDecreases.sol";
import {AllocationManagerIncreases} from "../../../src/v2/shared/AllocationManagerIncreases.sol";
import {MockExactQuoteToken} from "../mocks/MockV2QuoteAssets.sol";

contract MockDecreaseOfficialStockRegistry {
    mapping(bytes32 assetUid => AssetView assetView) private _assets;
    mapping(bytes32 assetUid => uint256 minimum) private _minimumAllocations;

    function configure(
        bytes32 assetUid,
        address stockToken,
        address vault,
        uint8 decimals,
        uint8 status,
        uint256 minimum
    ) external {
        _assets[assetUid] = AssetView({
            stockToken: stockToken, userStockVault: vault, tokenDecimals: decimals, status: status
        });
        _minimumAllocations[assetUid] = minimum;
    }

    function setStatus(bytes32 assetUid, uint8 status) external {
        _assets[assetUid].status = status;
    }

    function asset(bytes32 assetUid) external view returns (AssetView memory) {
        return _assets[assetUid];
    }

    function minimumAllocation(bytes32 assetUid) external view returns (uint256) {
        return _minimumAllocations[assetUid];
    }
}

contract MockDecreaseMarketRegistry {
    mapping(bytes32 marketId => MarketView marketView) private _markets;

    function configure(bytes32 marketId, bytes32 assetUid, address gauge, uint8 launchPhase, uint8 marketStatus)
        external
    {
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].runtime.launchPhase = launchPhase;
        _markets[marketId].runtime.marketStatus = marketStatus;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract AllocationManagerDecreasesHarness is AllocationManagerDecreases {
    constructor(address officialStockRegistry, address marketRegistry)
        AllocationManagerDecreases(officialStockRegistry, marketRegistry)
    {}

    function allocate(bytes32 marketId, uint256 amount) external {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function increaseAllocation(bytes32 marketId, uint256 amount) external {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function decreaseAllocation(bytes32 marketId, uint256 amount) external {
        _decreaseAllocation(msg.sender, marketId, amount, false);
    }

    function closeAllocation(bytes32 marketId) external {
        _decreaseAllocation(msg.sender, marketId, 0, true);
    }
}

contract MockDecreaseGauge {
    uint8 internal constant FAIL_CHECKPOINT = 1;
    uint8 internal constant FAIL_SETTLE = 2;
    uint8 internal constant FAIL_REMOVE = 3;
    uint8 internal constant NOOP_REMOVE = 4;
    uint8 internal constant REENTER_REMOVE = 5;

    address public manager;
    IUserStockVault public vault;
    bytes32 public assetUid;
    bytes32 public marketId;
    uint8 public failureMode;
    uint256 public checkpointCalls;
    uint256 public settleCalls;
    mapping(address user => PositionView position) private _positions;

    error InjectedGaugeFailure(uint8 stage);
    error InvalidManager(address caller);
    error InvalidCallOrder();
    error VaultReleasedTooEarly(uint256 expected, uint256 actual);

    function configure(address manager_, IUserStockVault vault_, bytes32 assetUid_, bytes32 marketId_) external {
        manager = manager_;
        vault = vault_;
        assetUid = assetUid_;
        marketId = marketId_;
    }

    function setFailureMode(uint8 mode) external {
        failureMode = mode;
    }

    function setPosition(address user, uint256 activeAmount, uint256 pendingAmount, uint64 unlockAt) external {
        PositionView storage position = _positions[user];
        position.activeAmount = activeAmount;
        position.pendingAmount = pendingAmount;
        position.unlockAt = unlockAt;
    }

    function checkpointActivations() external returns (uint256, uint256) {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        if (failureMode == FAIL_CHECKPOINT) revert InjectedGaugeFailure(FAIL_CHECKPOINT);
        ++checkpointCalls;
        return (0, 0);
    }

    function settle(address user) external {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        if (checkpointCalls != settleCalls + 1) revert InvalidCallOrder();
        if (failureMode == FAIL_SETTLE) revert InjectedGaugeFailure(FAIL_SETTLE);
        PositionView storage position = _positions[user];
        if (position.pendingAmount != 0 && block.timestamp >= position.pendingGeneration) {
            position.activeAmount += position.pendingAmount;
            position.pendingAmount = 0;
            position.pendingGeneration = 0;
        }
        ++settleCalls;
    }

    function addPending(address user, uint256 amount, uint64 activationAt, uint64 unlockAt) external {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        PositionView storage position = _positions[user];
        uint256 expected = position.activeAmount + position.pendingAmount + amount;
        if (vault.allocation(assetUid, user, marketId) != expected) revert InvalidCallOrder();
        position.pendingAmount += amount;
        position.pendingGeneration = activationAt;
        position.unlockAt = unlockAt;
    }

    function removeAllocation(address user, uint256 amount) external {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        if (failureMode == FAIL_REMOVE) revert InjectedGaugeFailure(FAIL_REMOVE);
        PositionView storage position = _positions[user];
        uint256 current = position.activeAmount + position.pendingAmount;
        uint256 vaultAmount = vault.allocation(assetUid, user, marketId);
        if (vaultAmount != current) revert VaultReleasedTooEarly(current, vaultAmount);
        if (failureMode == REENTER_REMOVE) IAllocationManager(manager).closeAllocation(marketId);
        if (failureMode == NOOP_REMOVE) return;

        uint256 fromPending = amount < position.pendingAmount ? amount : position.pendingAmount;
        position.pendingAmount -= fromPending;
        position.activeAmount -= amount - fromPending;
    }

    function positionOf(address user) external view returns (PositionView memory) {
        return _positions[user];
    }
}

contract AllocationManagerDecreasesTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockDecreaseOfficialStockRegistry internal officialRegistry;
    MockDecreaseMarketRegistry internal marketRegistry;
    AllocationManagerDecreasesHarness internal manager;
    MockDecreaseGauge internal gauge;
    MockExactQuoteToken internal stockToken;
    UserStockVault internal vault;

    event AllocationReleased(
        bytes32 indexed assetUid,
        address indexed user,
        bytes32 indexed marketId,
        uint256 amount,
        uint256 userMarketAllocation,
        uint256 userTotalAllocated
    );

    function setUp() public {
        officialRegistry = new MockDecreaseOfficialStockRegistry();
        marketRegistry = new MockDecreaseMarketRegistry();
        manager = new AllocationManagerDecreasesHarness(address(officialRegistry), address(marketRegistry));
        gauge = new MockDecreaseGauge();
        stockToken = new MockExactQuoteToken(18);
        vault = new UserStockVault(address(officialRegistry), address(marketRegistry), address(manager));
        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 18, 1, 0.5 ether);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 0);
        gauge.configure(address(manager), vault, ASSET_UID, MARKET_ID);
    }

    function test_decreaseSettlesRemovesGaugeFirstThenReleasesVaultAndEmitsPostState() public {
        _depositAndAllocate(ALICE, 2 ether, 1.5 ether);
        _warpToUnlock(ALICE);

        vm.expectEmit(true, true, false, true, address(vault));
        emit AllocationReleased(ASSET_UID, ALICE, MARKET_ID, 0.5 ether, 1 ether, 1 ether);
        vm.prank(ALICE);
        manager.decreaseAllocation(MARKET_ID, 0.5 ether);

        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.activeAmount, 1 ether);
        assertEq(position.pendingAmount, 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
        assertEq(vault.allocated(ASSET_UID, ALICE), 1 ether);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 1 ether);
    }

    function test_closeUsesEntireCurrentPositionAndOnlyReturnsItToVaultFreeBalance() public {
        _depositAndAllocate(ALICE, 2 ether, 1 ether);
        _warpToUnlock(ALICE);
        uint256 tokenBalanceBefore = stockToken.balanceOf(address(vault));

        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);

        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.allocated(ASSET_UID, ALICE), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 2 ether);
        assertEq(vault.totalAllocated(ASSET_UID), 0);
        assertEq(stockToken.balanceOf(address(vault)), tokenBalanceBefore);
        assertEq(stockToken.balanceOf(ALICE), 0);
    }

    function test_unlockBoundaryRejectsOneSecondBeforeAndAllowsExactTimestamp() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        uint64 unlockAt = gauge.positionOf(ALICE).unlockAt;
        vm.warp(unlockAt - 1);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerDecreases.PositionLockedUntil.selector, unlockAt));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);

        vm.warp(unlockAt);
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
    }

    function test_pausedAndRetiredMarketsAndAssetsStillAllowMatureExit() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _depositAndAllocate(BOB, 1 ether, 1 ether);
        _warpToUnlock(ALICE);

        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 1);
        officialRegistry.setStatus(ASSET_UID, 2);
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);

        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 2);
        officialRegistry.setStatus(ASSET_UID, 3);
        vm.prank(BOB);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.totalAllocated(ASSET_UID), 0);
    }

    function test_emergencyAndNonPoolCreatedSourcesRejectNormalExit() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _warpToUnlock(ALICE);

        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 3);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, MARKET_ID));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 3, 2);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.StockAllocationClosed.selector, MARKET_ID));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
    }

    function test_emergencyPrincipalExitIgnoresRevertingOrMissingGaugeButPauseCannotBypassLock() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _depositAndAllocate(BOB, 1 ether, 1 ether);
        uint64 unlockAt = gauge.positionOf(ALICE).unlockAt;
        vm.warp(unlockAt - 1);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 1);

        vm.expectRevert(abi.encodeWithSelector(AllocationManagerDecreases.PositionLockedUntil.selector, unlockAt));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);

        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 2, 3);
        gauge.setFailureMode(1);
        vm.startPrank(ALICE);
        assertEq(vault.forceReleaseAllocation(ASSET_UID, MARKET_ID), 1 ether);
        vault.withdrawFreeStock(ASSET_UID, 1 ether);
        vm.stopPrank();
        assertEq(stockToken.balanceOf(ALICE), 1 ether);

        vm.etch(address(gauge), hex"");
        assertEq(address(gauge).code.length, 0);
        vm.startPrank(BOB);
        assertEq(vault.forceReleaseAllocation(ASSET_UID, MARKET_ID), 1 ether);
        vault.withdrawFreeStock(ASSET_UID, 1 ether);
        vm.stopPrank();
        assertEq(stockToken.balanceOf(BOB), 1 ether);
        assertEq(vault.totalAllocated(ASSET_UID), 0);
        assertEq(vault.totalDeposited(ASSET_UID), 0);
    }

    function test_partialDecreaseCannotLeaveBelowConfiguredMinimumButExactBoundaryIsValid() public {
        _depositAndAllocate(ALICE, 2 ether, 1.5 ether);
        _warpToUnlock(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerIncreases.PositionBelowMinimum.selector, uint256(0.5 ether - 1), uint256(0.5 ether)
            )
        );
        vm.prank(ALICE);
        manager.decreaseAllocation(MARKET_ID, 1 ether + 1);

        vm.prank(ALICE);
        manager.decreaseAllocation(MARKET_ID, 1 ether);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0.5 ether);
    }

    function test_zeroOverAllocationAndEmptyCloseFailAtomically() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _warpToUnlock(ALICE);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerIncreases.InvalidAllocationAmount.selector, uint256(0)));
        vm.prank(ALICE);
        manager.decreaseAllocation(MARKET_ID, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                AllocationManagerDecreases.InsufficientAllocation.selector, uint256(1 ether + 1), uint256(1 ether)
            )
        );
        vm.prank(ALICE);
        manager.decreaseAllocation(MARKET_ID, 1 ether + 1);

        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        vm.expectRevert(
            abi.encodeWithSelector(AllocationManagerDecreases.NoAllocationPosition.selector, ALICE, MARKET_ID)
        );
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
    }

    function test_checkpointSettleRemoveFailuresAndNoopRollbackEveryState() public {
        for (uint8 mode = 1; mode <= 4; ++mode) {
            setUp();
            _depositAndAllocate(ALICE, 1 ether, 1 ether);
            _warpToUnlock(ALICE);
            uint256 checkpointsBefore = gauge.checkpointCalls();
            uint256 settlesBefore = gauge.settleCalls();
            gauge.setFailureMode(mode);

            vm.expectRevert();
            vm.prank(ALICE);
            manager.closeAllocation(MARKET_ID);
            assertEq(gauge.checkpointCalls(), checkpointsBefore);
            assertEq(gauge.settleCalls(), settlesBefore);
            assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
            assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 0);
        }
    }

    function test_preexistingGaugeVaultMismatchFailsClosed() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _warpToUnlock(ALICE);
        gauge.setPosition(ALICE, 2 ether, 0, uint64(block.timestamp));

        vm.expectRevert(AllocationManagerIncreases.AllocationLedgerMismatch.selector);
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
    }

    function test_reentrantGaugeCannotCloseOrLeavePartialRelease() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _warpToUnlock(ALICE);
        gauge.setFailureMode(5);

        vm.expectRevert();
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 0);
    }

    function test_noDecreaseForCloseForOrRecipientSurfaceAndBobCannotTouchAlice() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _warpToUnlock(ALICE);
        (bool decreaseFor,) = address(manager)
            .call(abi.encodeWithSignature("decreaseAllocationFor(address,bytes32,uint256)", ALICE, MARKET_ID, 1 ether));
        assertFalse(decreaseFor);
        (bool closeFor,) =
            address(manager).call(abi.encodeWithSignature("closeAllocationFor(address,bytes32)", ALICE, MARKET_ID));
        assertFalse(closeFor);

        vm.expectRevert();
        vm.prank(BOB);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
    }

    function testFuzz_decreaseAcceptsOnlyZeroOrAtLeastConfiguredMinimum(uint96 rawPosition, uint96 rawAmount) public {
        uint256 minimum = 0.5 ether;
        uint256 current = bound(rawPosition, minimum, 10 ether);
        uint256 amount = bound(rawAmount, 1, current);
        uint256 remaining = current - amount;
        _depositAndAllocate(ALICE, current, current);
        _warpToUnlock(ALICE);

        if (remaining != 0 && remaining < minimum) {
            vm.expectRevert(
                abi.encodeWithSelector(AllocationManagerIncreases.PositionBelowMinimum.selector, remaining, minimum)
            );
            vm.prank(ALICE);
            manager.decreaseAllocation(MARKET_ID, amount);
            assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), current);
        } else {
            vm.prank(ALICE);
            manager.decreaseAllocation(MARKET_ID, amount);
            assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), remaining);
            assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), amount);
        }
    }

    function _depositAndAllocate(address user, uint256 depositAmount, uint256 allocationAmount) private {
        stockToken.mint(user, depositAmount);
        vm.startPrank(user);
        stockToken.approve(address(vault), depositAmount);
        vault.depositStock(ASSET_UID, depositAmount);
        manager.allocate(MARKET_ID, allocationAmount);
        vm.stopPrank();
    }

    function _warpToUnlock(address user) private {
        vm.warp(gauge.positionOf(user).unlockAt);
    }
}
