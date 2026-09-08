// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {
    AssetView,
    IAllocationManager,
    IUserStockVault,
    MarketView,
    PositionView
} from "../../../src/v1/interfaces/IV1Protocol.sol";
import {UserStockVault} from "../../../src/v1/modules/UserStockVault.sol";
import {AllocationManagerExits} from "../../../src/v1/shared/AllocationManagerExits.sol";
import {AllocationManagerIncreases} from "../../../src/v1/shared/AllocationManagerIncreases.sol";
import {MockExactQuoteToken} from "../mocks/MockV1QuoteAssets.sol";

contract MockExitOfficialStockRegistry {
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

    function assetIdentityCurrent(bytes32) external pure returns (bool) {
        return true;
    }
}

contract MockExitMarketRegistry {
    mapping(bytes32 marketId => MarketView marketView) private _markets;

    function configure(bytes32 marketId, bytes32 assetUid, address gauge, uint8 launchPhase) external {
        _markets[marketId].config.assetUid = assetUid;
        _markets[marketId].config.gauge = gauge;
        _markets[marketId].config.stakingEnabled = true;
        _markets[marketId].runtime.launchPhase = launchPhase;
    }

    function market(bytes32 marketId) external view returns (MarketView memory) {
        return _markets[marketId];
    }
}

contract AllocationManagerExitsHarness is AllocationManagerExits {
    constructor(address officialStockRegistry, address marketRegistry)
        AllocationManagerExits(officialStockRegistry, marketRegistry)
    {}

    function allocate(bytes32 marketId, uint256 amount) external {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function increaseAllocation(bytes32 marketId, uint256 amount) external {
        _increaseAllocation(msg.sender, marketId, amount);
    }

    function closeAllocation(bytes32 marketId) external {
        _closeAllocation(msg.sender, marketId);
    }

    function rageQuit(bytes32 marketId) external {
        (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed) =
            _rageQuitAllocation(msg.sender, marketId);
        emit IAllocationManager.AllocationRageQuitExecuted(
            msg.sender, marketId, principal, quoteForfeited, memeForfeited, redistributed
        );
    }
}

contract MockExitGauge {
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

    function removeAllocation(address user) external returns (uint256) {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        if (failureMode == FAIL_REMOVE) revert InjectedGaugeFailure(FAIL_REMOVE);
        PositionView storage position = _positions[user];
        uint256 current = position.activeAmount + position.pendingAmount;
        uint256 vaultAmount = vault.allocation(assetUid, user, marketId);
        if (vaultAmount != current) revert VaultReleasedTooEarly(current, vaultAmount);
        if (failureMode == REENTER_REMOVE) IAllocationManager(manager).closeAllocation(marketId);
        if (failureMode == NOOP_REMOVE) return current;

        position.activeAmount = 0;
        position.pendingAmount = 0;
        position.pendingGeneration = 0;
        return current;
    }

    function rageQuit(address user)
        external
        returns (uint256 principal, uint256 quoteForfeited, uint256 memeForfeited, bool redistributed)
    {
        if (msg.sender != manager) revert InvalidManager(msg.sender);
        PositionView storage p = _positions[user];
        principal = p.activeAmount + p.pendingAmount;
        if (failureMode == FAIL_REMOVE) revert InjectedGaugeFailure(FAIL_REMOVE);
        if (failureMode == NOOP_REMOVE) return (principal, 0, 0, false);
        p.activeAmount = 0;
        p.pendingAmount = 0;
        p.pendingGeneration = 0;
    }

    function positionOf(address user) external view returns (PositionView memory) {
        return _positions[user];
    }
}

contract AllocationManagerExitsTest is Test {
    bytes32 internal constant ASSET_UID = keccak256("official-stock");
    bytes32 internal constant MARKET_ID = keccak256("market");
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    MockExitOfficialStockRegistry internal officialRegistry;
    MockExitMarketRegistry internal marketRegistry;
    AllocationManagerExitsHarness internal manager;
    MockExitGauge internal gauge;
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
        officialRegistry = new MockExitOfficialStockRegistry();
        marketRegistry = new MockExitMarketRegistry();
        manager = new AllocationManagerExitsHarness(address(officialRegistry), address(marketRegistry));
        gauge = new MockExitGauge();
        stockToken = new MockExactQuoteToken(18);
        vault = new UserStockVault(address(officialRegistry), address(marketRegistry), address(manager));
        officialRegistry.configure(ASSET_UID, address(stockToken), address(vault), 18, 1, 0.5 ether);
        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 1);
        gauge.configure(address(manager), vault, ASSET_UID, MARKET_ID);
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

    function test_closeClearsActiveAndMaturePendingPosition() public {
        _depositAndAllocate(ALICE, 2 ether, 1 ether);
        vm.warp(block.timestamp + 31 seconds);
        vm.prank(ALICE);
        manager.increaseAllocation(MARKET_ID, 1 ether);
        _warpToUnlock(ALICE);

        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        PositionView memory position = gauge.positionOf(ALICE);
        assertEq(position.activeAmount + position.pendingAmount, 0);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
    }

    function test_rageQuitWithdrawsFullPrincipalAndEmitsOutcome() public {
        _depositAndAllocate(ALICE, 2 ether, 1 ether);
        vm.expectEmit(true, true, false, true, address(manager));
        emit IAllocationManager.AllocationRageQuitExecuted(ALICE, MARKET_ID, 1 ether, 0, 0, false);
        vm.prank(ALICE);
        manager.rageQuit(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
        assertEq(vault.freeBalanceOf(ASSET_UID, ALICE), 1 ether);
        assertEq(stockToken.balanceOf(ALICE), 1 ether);
        assertEq(gauge.positionOf(ALICE).activeAmount, 0);
    }

    function test_emptyCloseAndRageQuitRevert() public {
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerExits.NoAllocationPosition.selector, ALICE, MARKET_ID));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerExits.NoAllocationPosition.selector, ALICE, MARKET_ID));
        vm.prank(ALICE);
        manager.rageQuit(MARKET_ID);
    }

    function test_unlockBoundaryRejectsOneSecondBeforeAndAllowsExactTimestamp() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        uint64 unlockAt = gauge.positionOf(ALICE).unlockAt;
        vm.warp(unlockAt - 1);
        vm.expectRevert(abi.encodeWithSelector(AllocationManagerExits.PositionLockedUntil.selector, unlockAt));
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);

        vm.warp(unlockAt);
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 0);
    }

    function test_pausedAndRetiredAssetsStillAllowMatureExit() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _depositAndAllocate(BOB, 1 ether, 1 ether);
        _warpToUnlock(ALICE);

        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 1);
        officialRegistry.setStatus(ASSET_UID, 2);
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);

        marketRegistry.configure(MARKET_ID, ASSET_UID, address(gauge), 1);
        officialRegistry.setStatus(ASSET_UID, 3);
        vm.prank(BOB);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.totalAllocated(ASSET_UID), 0);
    }

    function test_gaugeFailureAndNoopRollback() public {
        for (uint8 mode = 3; mode <= 4; ++mode) {
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

    function test_vaultWrongReturnAndPostconditionDriftRollback() public {
        _depositAndAllocate(ALICE, 1 ether, 1 ether);
        _warpToUnlock(ALICE);
        bytes memory callData =
            abi.encodeWithSelector(IUserStockVault.releaseAllocation.selector, ASSET_UID, ALICE, MARKET_ID);
        vm.mockCall(address(vault), callData, abi.encode(uint256(0)));
        vm.expectRevert();
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
        PositionView memory firstRollback = gauge.positionOf(ALICE);
        assertEq(firstRollback.activeAmount + firstRollback.pendingAmount, 1 ether);

        vm.clearMockedCalls();
        bytes memory allocationCall =
            abi.encodeWithSelector(IUserStockVault.allocation.selector, ASSET_UID, ALICE, MARKET_ID);
        vm.mockCall(address(vault), allocationCall, abi.encode(uint256(1 ether)));
        vm.expectRevert();
        vm.prank(ALICE);
        manager.closeAllocation(MARKET_ID);
        vm.clearMockedCalls();
        assertEq(vault.allocation(ASSET_UID, ALICE, MARKET_ID), 1 ether);
        PositionView memory secondRollback = gauge.positionOf(ALICE);
        assertEq(secondRollback.activeAmount + secondRollback.pendingAmount, 1 ether);
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
